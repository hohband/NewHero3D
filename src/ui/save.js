// 存档（对应 Godot 版 save_system.gd）：localStorage 单 key JSON，带 version
import { PlayerProfile } from "../core/meta/player_profile.js";

const KEY = "shuihu3d_save1";

export function hasSave() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function saveGame(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile.toDict()));
    return true;
  } catch (e) {
    console.error("存档失败", e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return PlayerProfile.fromDict(JSON.parse(raw));
  } catch (e) {
    console.error("读档失败", e);
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
