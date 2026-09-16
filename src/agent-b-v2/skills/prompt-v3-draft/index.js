/* @orphan @deprecated-draft
 * 说明：历史遗留草稿 Skill，默认系统提示词请使用 defaultFallback 或 liyongleElementary。
 * @qh-core LANE=B-V2 POINT=SKILL_V3_DRAFT V3 草稿 Prompt
 * 学霸小姐姐人设 + 四环骨架 + few-shot 示例驱动
 */
import { AGENT_B_V2_SYSTEM_PROMPT } from '../../prompt-v3-draft.js'

export const promptV3Draft = {
  id: 'prompt-v3-draft',
  name: 'V3 草稿 [历史遗留]（学霸小姐姐）',
  description: '【历史遗留草稿】未正式启用，生产环境请优先使用「系统标准」',
  buildSystemPrompt() {
    return AGENT_B_V2_SYSTEM_PROMPT
  },
}
