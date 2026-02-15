#!/usr/bin/env node
/**
 * Content Fetcher - 统一内容抓取模块
 * 
 * 封装 Jina Reader 调用逻辑，实现内容验证、缓存、错误处理，返回结构化的 FetchResult。
 * 
 * 使用方法:
 *   node content-fetcher.js <url> [options]
 * 
 * 选项 (JSON 格式):
 *   --options '{"minContentLength": 100, "enableCache": true, "cacheTTLHours": 24}'
 * 
 * 返回格式 (FetchResult):
 *   {
 *     success: boolean,
 *     markdown?: string,
 *     source: 'jina' | 'playwright' | 'cache' | 'error',
 *     url: string,
 *     fetchedAt: string,
 *     fallbackUsed: boolean,
 *     fallbackReason?: string,
 *     error?: string,
 *     metadata?: { contentLength: number, fetchDurationMs: number }
 *   }
 * 
 * Requirements: 1.1, 1.5, 6.1-6.5, 7.1-7.5
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 默认配置
const DEFAULT_OPTIONS = {
    minContentLength: 100,
    logLevel: 'info', // debug, info, warn, error
    enableCache: true,
    cacheTTLHours: 24,
    enablePlaywrightFallback: true,
    playwrightTimeout: 30000
};

// 日志级别优先级
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

// 缓存文件路径
const CACHE_FILE_PATH = path.resolve(__dirname, '../cache/content-cache.json');

// 域名失败计数器（用于连续失败警告）
const domainFailureCount = {};
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/**
 * 计算 URL 的哈希值（用于缓存键）
 * Requirements: 6.1
 */
function hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * 从 URL 提取域名
 */
function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return 'unknown';
    }
}

/**
 * 结构化日志记录器
 * 输出符合设计文档规范的日志条目
 * 
 * Requirements: 1.4, 7.1-7.5
 */
function createLogger(configuredLevel = 'info') {
    const minLevel = LOG_LEVELS[configuredLevel] || LOG_LEVELS.info;
    
    function log(level, entry) {
        const levelPriority = LOG_LEVELS[level] || LOG_LEVELS.info;
        if (levelPriority < minLevel) return;
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            ...entry
        };
        console.error(JSON.stringify(logEntry));
    }
    
    return {
        debug: (entry) => log('debug', entry),
        info: (entry) => log('info', entry),
        warn: (entry) => log('warn', entry),
        error: (entry) => log('error', entry),
        
        logFallback: function(url, fallbackReason, originalMethod, fallbackMethod, durationMs) {
            log('warn', {
                url, method: originalMethod, fallbackMethod,
                fallbackUsed: true, fallbackReason, durationMs,
                message: `Falling back from ${originalMethod} to ${fallbackMethod}: ${fallbackReason}`
            });
        },
        
        logFetchSuccess: function(url, method, fallbackUsed, durationMs, contentLength) {
            log('info', { url, method, success: true, fallbackUsed, durationMs, contentLength });
        },
        
        logFetchError: function(url, method, error, durationMs) {
            log('error', {
                url, method, success: false, durationMs,
                error: { type: error.type || 'UNKNOWN_ERROR', message: error.message || String(error) }
            });
        },
        
        /**
         * 记录连续失败警告
         * Requirements: 7.5
         */
        logConsecutiveFailure: function(domain, count) {
            log('warn', {
                domain, consecutiveFailures: count,
                message: `域名 ${domain} 连续失败 ${count} 次，建议检查网络连接或目标站点状态`
            });
        },
        
        /**
         * 记录缓存命中
         * Requirements: 6.4
         */
        logCacheHit: function(url, cacheAge) {
            log('debug', { url, source: 'cache', cacheAgeHours: cacheAge, message: 'Cache hit' });
        },
        
        /**
         * 记录资源清理
         * Requirements: 5.3, 5.4
         */
        logResourceCleanup: function(method, success) {
            log('debug', { method, resourceCleanup: true, success, message: `${method} browser closed` });
        }
    };
}

let logger = createLogger(DEFAULT_OPTIONS.logLevel);

/**
 * 缓存管理器
 * Requirements: 6.1-6.5
 */
const cacheManager = {
    /**
     * 加载缓存文件
     */
    loadCache: function() {
        try {
            if (fs.existsSync(CACHE_FILE_PATH)) {
                const data = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
                return JSON.parse(data);
            }
        } catch (e) {
            logger.debug({ message: 'Cache load failed, starting fresh', error: e.message });
        }
        return { schema_version: '2.0', entries: {} };
    },
    
    /**
     * 保存缓存文件
     */
    saveCache: function(cache) {
        try {
            const cacheDir = path.dirname(CACHE_FILE_PATH);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2));
        } catch (e) {
            logger.debug({ message: 'Cache save failed', error: e.message });
        }
    },
    
    /**
     * 检查缓存是否有效
     * Requirements: 6.2, 6.3
     */
    get: function(url, ttlHours) {
        const cache = this.loadCache();
        const urlHash = hashUrl(url);
        const entry = cache.entries[urlHash];
        
        if (!entry) return null;
        
        const expiresAt = new Date(entry.expiresAt);
        if (expiresAt <= new Date()) {
            // 缓存已过期
            return null;
        }
        
        const cacheAgeHours = (Date.now() - new Date(entry.fetchedAt).getTime()) / (1000 * 60 * 60);
        logger.logCacheHit(url, cacheAgeHours.toFixed(2));
        
        return entry;
    },
    
    /**
     * 保存到缓存
     * Requirements: 6.1
     */
    set: function(url, markdown, source, fetchDurationMs, ttlHours) {
        const cache = this.loadCache();
        const urlHash = hashUrl(url);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
        
        cache.entries[urlHash] = {
            url,
            markdown,
            source,
            fetchedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            contentLength: markdown.length,
            fetchDurationMs
        };
        
        this.saveCache(cache);
    },
    
    /**
     * 清除指定 URL 的缓存
     * Requirements: 6.5
     */
    clearUrl: function(url) {
        const cache = this.loadCache();
        const urlHash = hashUrl(url);
        delete cache.entries[urlHash];
        this.saveCache(cache);
    },
    
    /**
     * 清除全部缓存
     * Requirements: 6.5
     */
    clearAll: function() {
        this.saveCache({ schema_version: '2.0', entries: {} });
    }
};

/**
 * 跟踪域名失败次数并在达到阈值时发出警告
 * Requirements: 7.5
 */
function trackDomainFailure(url) {
    const domain = extractDomain(url);
    domainFailureCount[domain] = (domainFailureCount[domain] || 0) + 1;
    
    if (domainFailureCount[domain] >= CONSECUTIVE_FAILURE_THRESHOLD) {
        logger.logConsecutiveFailure(domain, domainFailureCount[domain]);
    }
}

/**
 * 重置域名失败计数（成功时调用）
 */
function resetDomainFailure(url) {
    const domain = extractDomain(url);
    domainFailureCount[domain] = 0;
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const url = args[0];
    let options = { ...DEFAULT_OPTIONS };
    
    const optionsIndex = args.indexOf('--options');
    if (optionsIndex !== -1 && args[optionsIndex + 1]) {
        try {
            const customOptions = JSON.parse(args[optionsIndex + 1]);
            options = { ...options, ...customOptions };
        } catch (e) { /* ignore */ }
    }
    
    if (options.logLevel) {
        logger = createLogger(options.logLevel);
    }
    
    return { url, options };
}

/**
 * 验证 URL 格式
 */
function validateUrl(url) {
    if (!url) return { valid: false, error: 'No URL provided' };
    try {
        new URL(url);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: `Invalid URL format: ${url}` };
    }
}

/**
 * 调用 Jina Reader 脚本
 */
function callJinaReader(url) {
    const scriptDir = __dirname;
    const jinaScriptPath = path.resolve(scriptDir, 'fetch-jina.js');
    
    try {
        const result = execSync(`node "${jinaScriptPath}" "${url}"`, {
            encoding: 'utf-8',
            timeout: 60000,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return JSON.parse(result.trim());
    } catch (e) {
        if (e.stderr) {
            try { return JSON.parse(e.stderr.trim()); } catch (parseError) { /* ignore */ }
        }
        return { error: e.message || 'Jina Reader execution failed', fallback: true, reason: 'Jina API request failed' };
    }
}

/**
 * 验证内容有效性
 */
function validateContent(markdown, minContentLength) {
    if (!markdown) return { valid: false, reason: 'Empty content returned' };
    if (markdown.length < minContentLength) {
        return { valid: false, reason: `Content too short: ${markdown.length} < ${minContentLength} characters` };
    }
    if (markdown.includes('Error') && markdown.includes('Unable to fetch')) {
        return { valid: false, reason: 'Error page detected in content' };
    }
    return { valid: true };
}

/**
 * 创建缓存命中的 FetchResult
 * Requirements: 6.4
 */
function createCacheResult(url, cacheEntry, startTime) {
    return {
        success: true,
        markdown: cacheEntry.markdown,
        source: 'cache',
        url,
        fetchedAt: new Date().toISOString(),
        fallbackUsed: false,
        metadata: {
            contentLength: cacheEntry.contentLength,
            fetchDurationMs: Date.now() - startTime,
            cachedAt: cacheEntry.fetchedAt
        }
    };
}

/**
 * 创建成功的 FetchResult
 */
function createSuccessResult(url, markdown, source, startTime, fallbackUsed = false, fallbackReason = null) {
    const fetchDurationMs = Date.now() - startTime;
    logger.logFetchSuccess(url, source, fallbackUsed, fetchDurationMs, markdown.length);
    resetDomainFailure(url);
    
    const result = {
        success: true,
        markdown,
        source,
        url,
        fetchedAt: new Date().toISOString(),
        fallbackUsed,
        metadata: { contentLength: markdown.length, fetchDurationMs }
    };
    
    if (fallbackReason) result.fallbackReason = fallbackReason;
    return result;
}

/**
 * 创建需要回退的 FetchResult
 */
function createFallbackResult(url, reason, startTime) {
    const fetchDurationMs = Date.now() - startTime;
    logger.logFallback(url, reason, 'jina', 'playwright', fetchDurationMs);
    
    return {
        success: false,
        source: 'error',
        url,
        fetchedAt: new Date().toISOString(),
        fallbackUsed: false,
        fallbackReason: reason,
        error: `Jina Reader failed: ${reason}`,
        metadata: { contentLength: 0, fetchDurationMs }
    };
}

/**
 * 创建错误的 FetchResult
 */
function createErrorResult(url, error, startTime = Date.now()) {
    const fetchDurationMs = Date.now() - startTime;
    if (url) {
        logger.logFetchError(url, 'jina', { type: 'FETCH_ERROR', message: error }, fetchDurationMs);
        trackDomainFailure(url);
    }
    return {
        success: false,
        source: 'error',
        url: url || '',
        fetchedAt: new Date().toISOString(),
        fallbackUsed: false,
        error,
        metadata: { contentLength: 0, fetchDurationMs }
    };
}

/**
 * 主函数：执行内容抓取
 * Requirements: 1.1-1.6, 6.1-6.4
 */
async function fetchContent(url, options = DEFAULT_OPTIONS) {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // 1. 验证 URL
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
        return createErrorResult(url, urlValidation.error, startTime);
    }
    
    // 2. 检查缓存 (Requirements: 6.2, 6.3)
    if (opts.enableCache) {
        const cacheEntry = cacheManager.get(url, opts.cacheTTLHours);
        if (cacheEntry) {
            return createCacheResult(url, cacheEntry, startTime);
        }
    }
    
    // 3. 调用 Jina Reader
    const jinaResult = callJinaReader(url);
    
    // 4. 检查 Jina 是否成功
    if (jinaResult.error || jinaResult.fallback) {
        const reason = jinaResult.reason || jinaResult.error || 'Unknown Jina error';
        trackDomainFailure(url);
        return createFallbackResult(url, reason, startTime);
    }
    
    // 5. 验证内容有效性
    const contentValidation = validateContent(jinaResult.markdown, opts.minContentLength);
    if (!contentValidation.valid) {
        trackDomainFailure(url);
        return createFallbackResult(url, contentValidation.reason, startTime);
    }
    
    // 6. 保存到缓存 (Requirements: 6.1)
    if (opts.enableCache) {
        cacheManager.set(url, jinaResult.markdown, 'jina', Date.now() - startTime, opts.cacheTTLHours);
    }
    
    // 7. 返回成功结果
    return createSuccessResult(url, jinaResult.markdown, 'jina', startTime);
}

/**
 * 入口点
 */
async function main() {
    const { url, options } = parseArgs();
    const result = await fetchContent(url, options);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
}

// 导出函数供其他模块使用
module.exports = {
    fetchContent,
    validateUrl,
    validateContent,
    callJinaReader,
    createSuccessResult,
    createFallbackResult,
    createErrorResult,
    createCacheResult,
    createLogger,
    cacheManager,
    hashUrl,
    extractDomain,
    trackDomainFailure,
    resetDomainFailure,
    DEFAULT_OPTIONS,
    LOG_LEVELS,
    CONSECUTIVE_FAILURE_THRESHOLD
};

if (require.main === module) {
    main().catch(e => {
        console.error(JSON.stringify(createErrorResult(null, e.message)));
        process.exit(1);
    });
}

