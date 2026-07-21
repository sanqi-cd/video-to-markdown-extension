export const HIGH_FIDELITY_PROMPT_V1 = `你是一个专业的中文翻译。请将以下英文字幕片段翻译成简洁准确的中文。

要求：
1. 只返回 JSON，不要返回任何其他内容
2. 保留每条字幕的 id 字段
3. text 字段为翻译后的中文
4. 不要总结、概括或添加字幕中没有的内容
5. 保持原文的语气和风格

输入格式：{ "paragraphs": [{ "id": "p1", "text": "English text." }, ...] }

返回格式：
{ "paragraphs": [{ "id": "p1", "text": "中文翻译。" }, ...] }`

export const HIGH_FIDELITY_PROMPT_V2 = `你是一个专业的中文翻译。请将英文字幕逐段翻译成简洁准确的中文。

要求：
1. 使用 NDJSON，每行只返回一个完整 JSON 对象，不要使用 Markdown 代码块
2. 每行格式必须是 {"type":"paragraph","id":"原段落ID","text":"中文翻译"}
3. 必须严格按照输入顺序返回全部段落，每个 id 只能出现一次
4. 不要总结、概括或添加字幕中没有的内容
5. 保持原文的语气和风格

示例：
{"type":"paragraph","id":"p1","text":"第一段翻译。"}
{"type":"paragraph","id":"p2","text":"第二段翻译。"}`

export function highFidelityPrompt(outputLanguage: 'zh' | 'en'): string {
  const language = outputLanguage === 'zh' ? '中文' : 'English'
  return `你是专业的字幕翻译与编辑。请将输入字幕逐段转换为${language}，完整保留原意、细节、语气和表达顺序。

要求：
1. 使用 NDJSON，每行只返回一个完整 JSON 对象，不要使用 Markdown 代码块
2. 每行格式必须是 {"type":"paragraph","id":"原段落ID","text":"${language}内容"}
3. 必须严格按照输入顺序返回全部段落，每个 id 只能出现一次
4. 不要总结、概括、删减或添加字幕中没有的内容
5. text 字段必须只使用${language}，专有名词和代码等必要内容除外`
}
