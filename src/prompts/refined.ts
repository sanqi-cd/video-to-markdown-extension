export const REFINED_MAP_PROMPT_V1 = `你是一个专业的笔记整理助手。请从以下字幕片段中提取结构化信息。

要求：
1. 只返回 JSON，不要返回任何其他内容
2. 从文本中提取关键信息，标注每条信息的来源段落 ID
3. 不要虚构、推测或添加字幕中没有的内容
4. 如果某类信息不存在，返回空数组 []

返回格式：
{
  "chapterCandidates": [{ "title": "章节标题", "sourceParagraphIds": ["p1", "p2"] }],
  "claims": [{ "text": "观点", "sourceParagraphIds": ["p3"] }],
  "facts": [{ "text": "事实", "sourceParagraphIds": ["p4"] }],
  "people": [{ "name": "人名", "sourceParagraphIds": ["p5"] }],
  "examples": [{ "text": "案例", "sourceParagraphIds": ["p6"] }],
  "conclusions": [{ "text": "结论", "sourceParagraphIds": ["p7"] }]
}`

export const REFINED_REDUCE_PROMPT_V1 = `你是一个专业的内容编辑。请将以下多个片段提取的结构化信息合并成一份完整的笔记。

要求：
1. 只返回 JSON，不要返回任何其他内容
2. 合并重复内容，保持全局结构清晰
3. 所有 sourceParagraphIds 必须来自输入中的有效段落 ID
4. overview 为 1-2 句整体概括
5. coreIdeas 为核心观点列表（最多 5 条）
6. chapters 为结构化的章节笔记
7. importantFacts 为重要的事实和数据
8. conclusion 为总结与启发

返回格式：
{
  "overview": "整体概括",
  "coreIdeas": ["核心观点1", "核心观点2"],
  "chapters": [{ "title": "章节", "body": "内容", "sourceParagraphIds": ["p1"] }],
  "importantFacts": [{ "text": "重要事实", "sourceParagraphIds": ["p2"] }],
  "conclusion": "总结与启发"
}`

export const REFINED_REDUCE_PROMPT_V2 = `你是一个专业的内容编辑。请将多个片段的结构化信息合并成完整中文笔记。

使用 NDJSON 输出，每行只包含一个完整 JSON 对象，不要使用 Markdown 代码块。允许的行类型：
{"type":"overview","text":"1-2 句整体概括"}
{"type":"core_idea","text":"一条核心观点"}
{"type":"chapter","title":"章节标题","body":"章节正文","sourceParagraphIds":["p1"]}
{"type":"fact","text":"重要事实或数据","sourceParagraphIds":["p2"]}
{"type":"conclusion","text":"总结与启发"}

要求：
1. overview 和 conclusion 各返回且只返回一次
2. core_idea 最多 5 条
3. 合并重复内容，保持全局结构清晰
4. 所有 sourceParagraphIds 必须来自输入中的有效段落 ID
5. 不要虚构、推测或添加输入中没有的内容`

export function refinedMapPrompt(outputLanguage: 'zh' | 'en'): string {
  const language = outputLanguage === 'zh' ? '中文' : 'English'
  return `${REFINED_MAP_PROMPT_V1}

所有 title、text 和 name 字段必须使用${language}输出，专有名词除外。`
}

export function refinedReducePrompt(outputLanguage: 'zh' | 'en'): string {
  const language = outputLanguage === 'zh' ? '中文' : 'English'
  return `${REFINED_REDUCE_PROMPT_V2}
6. 所有生成的标题与正文必须使用${language}，专有名词除外`
}
