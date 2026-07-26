// 程序化单位立绘（Canvas 纹理）：品质色边框卡片 + 姓氏大字 + 职业/绰号 + 血条怒气条
// 资源全部重新设计，不依赖原 Godot 美术。
import * as THREE from "three";

export const QUALITY_COLORS = {
  orange: "#e8a13c", purple: "#a06cd5", blue: "#4f8fd0", green: "#5aa860",
};
export const CLASS_INFO = {
  vanguard: { label: "先锋", icon: "盾", color: "#7a8ba0" },
  infantry: { label: "步军", icon: "剑", color: "#a0785a" },
  cavalry: { label: "马军", icon: "骑", color: "#b05a4a" },
  archer: { label: "神射", icon: "弓", color: "#5a9a6a" },
  strategist: { label: "谋士", icon: "扇", color: "#6a6ab0" },
  healer: { label: "医者", icon: "药", color: "#4aa08a" },
  support: { label: "辅助", icon: "旗", color: "#a09a5a" },
};
export const TEAM_COLORS = {
  0: "#3d6fd6", // PLAYER 蓝
  1: "#c94040", // ENEMY 红
  2: "#3f9e58", // NPC_ALLY 绿
};

const PORTRAIT_W = 128;
const PORTRAIT_H = 176;
const textureCache = new Map();

// 名字配色哈希（同一武将稳定配色）
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 38%, 30%)`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 生成武将立绘纹理（不含血条，血条由 updateBars 画到动态 canvas）
export function getPortraitTexture(unitData) {
  const key = unitData.unit_id;
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_W;
  canvas.height = PORTRAIT_H;
  const ctx = canvas.getContext("2d");
  const qc = QUALITY_COLORS[unitData.quality] || "#888";
  const ci = CLASS_INFO[unitData.unit_class] || { label: "?", icon: "?", color: "#888" };
  // 底
  const grad = ctx.createLinearGradient(0, 0, 0, PORTRAIT_H);
  grad.addColorStop(0, hashColor(unitData.unit_id));
  grad.addColorStop(1, "#1a1a22");
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, PORTRAIT_W, PORTRAIT_H, 12);
  ctx.fill();
  // 边框
  ctx.strokeStyle = qc;
  ctx.lineWidth = 5;
  roundRect(ctx, 3, 3, PORTRAIT_W - 6, PORTRAIT_H - 6, 10);
  ctx.stroke();
  // 大字（姓名首字）
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "bold 64px 'Songti SC', 'STKaiti', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(unitData.name.slice(0, 1), PORTRAIT_W / 2, 58);
  // 职业图标
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = ci.color;
  ctx.fillText(ci.icon, PORTRAIT_W / 2, 104);
  // 名字
  ctx.font = "bold 20px 'Songti SC', serif";
  ctx.fillStyle = "#f0ead8";
  ctx.fillText(unitData.name, PORTRAIT_W / 2, 132);
  // 绰号
  if (unitData.nickname) {
    ctx.font = "14px 'Songti SC', serif";
    ctx.fillStyle = "#c8bfA8";
    ctx.fillText(unitData.nickname, PORTRAIT_W / 2, 154);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

// 动态单位画布：立绘 + 底部血条/怒气条（每次刷新重绘）
export class UnitCard {
  constructor(unitData) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = PORTRAIT_W;
    this.canvas.height = PORTRAIT_H + 26;
    this.ctx = this.canvas.getContext("2d");
    this.base = getPortraitTexture(unitData).image;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(1, 0, false);
  }
  draw(hpRatio, rageRatio, channeling) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    // 血条
    const bw = PORTRAIT_W - 16;
    ctx.fillStyle = "#222";
    ctx.fillRect(8, PORTRAIT_H + 2, bw, 8);
    ctx.fillStyle = hpRatio > 0.35 ? "#4fc35a" : "#d04040";
    ctx.fillRect(8, PORTRAIT_H + 2, bw * Math.max(0, hpRatio), 8);
    // 怒气条
    ctx.fillStyle = "#222";
    ctx.fillRect(8, PORTRAIT_H + 13, bw, 6);
    ctx.fillStyle = rageRatio >= 1 ? "#ffd75e" : "#c9a24a";
    ctx.fillRect(8, PORTRAIT_H + 13, bw * Math.max(0, Math.min(1, rageRatio)), 6);
    if (channeling) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(PORTRAIT_W - 14, 14, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    this.texture.needsUpdate = true;
  }
}
