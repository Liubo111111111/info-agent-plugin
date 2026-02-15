#!/usr/bin/env node
/**
 * 修复 Markdown 文件中的编码乱码
 * 使用方法: node fix-encoding.js <file_path>
 */

const fs = require('fs');

const targetFile = process.argv[2];

if (!targetFile) {
    console.error(JSON.stringify({ error: 'No file path provided', usage: 'node fix-encoding.js <file_path>' }));
    process.exit(1);
}

// 乱码替换映射表（使用字符串替换，避免正则性能问题）
const replacements = [
    // 智能引号和撇号组合
    ['鈥檚', "'s"],
    ['鈥檛', "n't"],
    ['鈥檝e', "'ve"],
    ['鈥檙e', "'re"],
    ['鈥檓', "'m"],
    ['鈥檒l', "'ll"],
    ['鈥檇', "'d"],
    // 引号+字母组合
    ['鈥淚', '"I'],
    ['鈥渂', '"b'],
    ['鈥渟', '"s'],
    ['鈥渢', '"t'],
    ['鈥渨', '"w'],
    ['鈥渁', '"a'],
    ['鈥渆', '"e'],
    ['鈥渇', '"f'],
    ['鈥渋', '"i'],
    ['鈥渕', '"m'],
    ['鈥渘', '"n'],
    ['鈥渙', '"o'],
    ['鈥渞', '"r'],
    ['鈥渦', '"u'],
    ['鈥済', '"g'],
    ['鈥渃', '"c'],
    ['鈥渄', '"d'],
    ['鈥渉', '"h'],
    ['鈥渓', '"l'],
    ['鈥渒', '"k'],
    ['鈥渏', '"j'],
    ['鈥渧', '"v'],
    ['鈥渪', '"x'],
    ['鈥渰', '"y'],
    ['鈥渱', '"z'],
    ['鈥漒n', '"\n'],
    // 单独的乱码字符
    ['鈥?', '"'],
    ['鈥', '"'],
    ['锛', '：'],
    ['銆', '。'],
];

function fixEncoding(content) {
    let fixed = content;
    let changeCount = 0;
    
    for (const [from, to] of replacements) {
        while (fixed.includes(from)) {
            fixed = fixed.replace(from, to);
            changeCount++;
        }
    }
    
    return { content: fixed, changes: changeCount };
}

function main() {
    try {
        if (!fs.existsSync(targetFile)) {
            console.error(JSON.stringify({ error: `File not found: ${targetFile}` }));
            process.exit(1);
        }
        
        const content = fs.readFileSync(targetFile, 'utf8');
        const { content: fixedContent, changes } = fixEncoding(content);
        
        if (changes === 0) {
            console.log(JSON.stringify({ success: true, message: 'No encoding issues found', file: targetFile, changes: 0 }));
            return;
        }
        
        fs.writeFileSync(targetFile, fixedContent, 'utf8');
        console.log(JSON.stringify({ success: true, message: `Fixed ${changes} encoding issues`, file: targetFile, changes }));
        
    } catch (e) {
        console.error(JSON.stringify({ error: e.message, file: targetFile }));
        process.exit(1);
    }
}

main();
