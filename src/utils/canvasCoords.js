/**
 * 画布坐标
 * - 甲方真画布：1726 × 980（落最终画面）
 * - 夏夏表稿参考尺寸：1892 × 1044（表里写的像素坐标按此估算）
 * 换算：实际X = 表中X * 1726/1892；实际Y = 表中Y * 980/1044
 */
// 画布尺寸唯一真源：src/services/stepHandoff.js 的 CANVAS_SIZE
import { CANVAS_SIZE } from '../services/stepHandoff.js'

export const CANVAS_W = CANVAS_SIZE.width
export const CANVAS_H = CANVAS_SIZE.height
export const BOARD_DESIGN_SIZE = Object.freeze({ width: CANVAS_W, height: CANVAS_H })

export function buildGridLines() {
  const minor = []
  const major = []
  for (let p = 5; p < 100; p += 5) {
    const item = { p, major: p % 10 === 0 }
    if (item.major) major.push(item)
    else minor.push(item)
  }
  return { minor, major }
}