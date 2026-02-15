#!/usr/bin/env node
/**
 * X/Twitter 内容快速提取脚本
 * 使用方法: node fetch-x.js <url>
 * 
 * 尝试通过 API 或页面解析快速获取内容
 * 如果失败，返回错误码让调用者使用 Playwright 兜底
 */

const https = require('https');
const url = require('url');

const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error(JSON.stringify({ error: 'No URL provided', fallback: true }));
    process.exit(1);
}

// 解析 URL 获取 tweet/article ID
function parseXUrl(urlStr) {
    const parsed = new URL(urlStr);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    
    // /username/status/id 或 /username/article/id
    if (pathParts.length >= 3) {
        return {
            username: pathParts[0],
            type: pathParts[1], // status 或 article
            id: pathParts[2]
        };
    }
    return null;
}

// 尝试使用 syndication API (公开，无需认证)
function fetchViaSyndication(tweetId) {
    return new Promise((resolve, reject) => {
        const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`;
        
        https.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(new Error('Parse error'));
                }
            });
        }).on('error', reject);
    });
}

// 转换为 Markdown
function toMarkdown(data) {
    const md = [];
    
    // 标题
    const title = data.text?.split('\n')[0]?.substring(0, 100) || 'Tweet';
    md.push(`# ${title}`);
    md.push('');
    
    // 元信息
    if (data.user?.screen_name) {
        md.push(`**作者**: [@${data.user.screen_name}](https://x.com/${data.user.screen_name})`);
    }
    if (data.created_at) {
        md.push(`**日期**: ${new Date(data.created_at).toISOString().split('T')[0]}`);
    }
    md.push(`**链接**: ${targetUrl}`);
    md.push('');
    md.push('---');
    md.push('');
    
    // 内容
    if (data.text) {
        md.push(data.text);
    }
    
    // 媒体
    if (data.mediaDetails?.length > 0) {
        md.push('');
        data.mediaDetails.forEach(media => {
            if (media.media_url_https) {
                md.push(`![image](${media.media_url_https})`);
            }
        });
    }
    
    return md.join('\n');
}

async function main() {
    const parsed = parseXUrl(targetUrl);
    
    if (!parsed) {
        console.error(JSON.stringify({ error: 'Invalid X URL', fallback: true }));
        process.exit(1);
    }
    
    // Article 类型需要 Playwright
    if (parsed.type === 'article') {
        console.error(JSON.stringify({ 
            error: 'Article requires browser rendering', 
            fallback: true,
            reason: 'X articles use client-side rendering'
        }));
        process.exit(1);
    }
    
    try {
        const data = await fetchViaSyndication(parsed.id);
        const markdown = toMarkdown(data);
        console.log(JSON.stringify({ 
            success: true, 
            markdown,
            source: 'syndication-api'
        }));
    } catch (e) {
        console.error(JSON.stringify({ 
            error: e.message, 
            fallback: true,
            reason: 'API request failed, need browser'
        }));
        process.exit(1);
    }
}

main();
