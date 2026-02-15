#!/usr/bin/env node
/**
 * 通用网页内容快速提取脚本
 * 使用方法: node fetch-generic.js <url>
 * 
 * 尝试直接获取 HTML 并解析，适用于静态页面
 * 如果页面需要 JS 渲染，返回 fallback 标记
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error(JSON.stringify({ error: 'No URL provided', fallback: true }));
    process.exit(1);
}

function fetchPage(urlStr, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }
        
        const parsed = new URL(urlStr);
        const client = parsed.protocol === 'https:' ? https : http;
        
        client.get(urlStr, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
            }
        }, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, urlStr).href;
                resolve(fetchPage(redirectUrl, redirectCount + 1));
                return;
            }
            
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// 简单 HTML 解析（不依赖外部库）
function parseHtml(html) {
    // 提取 title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // 提取 meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : '';
    
    // 提取 og:image
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const ogImage = ogImageMatch ? ogImageMatch[1] : '';
    
    // 检测是否需要 JS 渲染
    const needsJs = 
        html.includes('__NEXT_DATA__') ||
        html.includes('window.__INITIAL_STATE__') ||
        html.includes('id="root"></div>') ||
        html.includes('id="app"></div>') ||
        (html.match(/<script/gi) || []).length > 10;
    
    // 提取正文（简单方法）
    let content = '';
    
    // 尝试提取 article 标签
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
        content = articleMatch[1];
    } else {
        // 尝试提取 main 标签
        const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (mainMatch) {
            content = mainMatch[1];
        }
    }
    
    // 清理 HTML 标签
    content = content
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    
    return { title, description, ogImage, content, needsJs };
}

function toMarkdown(data, url) {
    const md = [];
    
    if (data.title) {
        md.push(`# ${data.title}`);
        md.push('');
    }
    
    md.push(`**链接**: ${url}`);
    md.push('');
    
    if (data.description) {
        md.push(`> ${data.description}`);
        md.push('');
    }
    
    md.push('---');
    md.push('');
    
    if (data.ogImage) {
        md.push(`![](${data.ogImage})`);
        md.push('');
    }
    
    if (data.content) {
        md.push(data.content.substring(0, 10000));
    }
    
    return md.join('\n');
}

async function main() {
    try {
        const html = await fetchPage(targetUrl);
        const parsed = parseHtml(html);
        
        // 如果内容太少或需要 JS，建议使用 Playwright
        if (parsed.needsJs || parsed.content.length < 200) {
            console.error(JSON.stringify({
                error: 'Page requires JavaScript rendering',
                fallback: true,
                reason: parsed.needsJs ? 'SPA detected' : 'Content too short',
                partial: {
                    title: parsed.title,
                    description: parsed.description
                }
            }));
            process.exit(1);
        }
        
        const markdown = toMarkdown(parsed, targetUrl);
        console.log(JSON.stringify({
            success: true,
            markdown,
            source: 'direct-fetch'
        }));
        
    } catch (e) {
        console.error(JSON.stringify({
            error: e.message,
            fallback: true,
            reason: 'Fetch failed'
        }));
        process.exit(1);
    }
}

main();
