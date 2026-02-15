#!/usr/bin/env node
/**
 * 使用 Jina Reader API 获取网页 Markdown
 * 使用方法: node fetch-jina.js <url>
 * 
 * Jina Reader: https://r.jina.ai/<url>
 * - 免费，无需 API key
 * - 自动处理 JS 渲染
 * - 直接返回 Markdown 格式
 */

const https = require('https');

const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error(JSON.stringify({ error: 'No URL provided', fallback: true }));
    process.exit(1);
}

function fetchViaJina(url) {
    return new Promise((resolve, reject) => {
        const jinaUrl = `https://r.jina.ai/${url}`;
        
        https.get(jinaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/plain'
            }
        }, (res) => {
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

async function main() {
    try {
        const markdown = await fetchViaJina(targetUrl);
        
        // 检查是否获取到有效内容
        if (!markdown || markdown.length < 100) {
            console.error(JSON.stringify({
                error: 'Content too short or empty',
                fallback: true,
                reason: 'Jina returned insufficient content'
            }));
            process.exit(1);
        }
        
        // 检查是否是错误页面
        if (markdown.includes('Error') && markdown.includes('Unable to fetch')) {
            console.error(JSON.stringify({
                error: 'Jina failed to fetch page',
                fallback: true,
                reason: 'Page may require authentication or is blocked'
            }));
            process.exit(1);
        }
        
        console.log(JSON.stringify({
            success: true,
            markdown: markdown,
            source: 'jina-reader',
            url: targetUrl
        }));
        
    } catch (e) {
        console.error(JSON.stringify({
            error: e.message,
            fallback: true,
            reason: 'Jina API request failed'
        }));
        process.exit(1);
    }
}

main();
