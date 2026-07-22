// 劫寨 Demo 模型库 —— 用 Three.js 基础几何体拼装高辨识度单位/建筑
// 原则：剪影 + 标志道具 + 头顶姓名标签，远处一眼可辨。所有模型地面锚定（y=0 起）。
import * as THREE from "three";

function mat(color, opt = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opt });
}
function box(w, h, d, color, x = 0, y = 0, z = 0, opt) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opt));
  m.position.set(x, y, z);
  return m;
}
function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 10, opt) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opt));
  m.position.set(x, y, z);
  return m;
}
function sph(r, color, x = 0, y = 0, z = 0, opt) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat(color, opt));
  m.position.set(x, y, z);
  return m;
}
function cone(r, h, color, x = 0, y = 0, z = 0, seg = 8, opt) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, opt));
  m.position.set(x, y, z);
  return m;
}

// 队伍基座环（梁山=金，守军=暗红）
function baseRing(color) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.44, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

// 头顶姓名标签（单个字，颜色底）
function nameLabel(text, bgColor) {
  const cvs = document.createElement("canvas");
  cvs.width = 64; cvs.height = 64;
  const ctx = cvs.getContext("2d");
  ctx.fillStyle = bgColor;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#000"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 34px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 36);
  const tex = new THREE.CanvasTexture(cvs);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(0.5, 0.5, 1);
  return spr;
}

// ============ 武将模型 ============
// 返回 { group, labelY }
export function buildHero(heroId) {
  const g = new THREE.Group();
  const skin = 0xe8b890;
  const hex = (s) => "#" + s.toString(16).padStart(6, "0");
  let label, labelY = 1.5, labelColor = "#888";

  const builders = {
    // 鲁智深：魁梧绿僧 + 月牙禅杖 + 大肚
    luzhishen() {
      g.add(cyl(0.30, 0.38, 0.9, 0x3a7a3a, 0, 0.45, 0));        // 僧袍（粗壮）
      g.add(sph(0.24, skin, 0, 1.05, 0));                       // 光头
      g.add(cyl(0.03, 0.03, 1.5, 0x8a6a3a, 0.42, 0.75, 0));     // 禅杖杆
      g.add(box(0.05, 0.28, 0.34, 0xc8c8c8, 0.42, 1.5, 0));     // 月牙铲
      label = "鲁"; labelColor = "#3a7a3a"; labelY = 1.6;
    },
    // 林冲：蓝瘦 + 长枪 + 毡帽
    linchong() {
      g.add(cyl(0.20, 0.26, 1.0, 0x3a5a9a, 0, 0.5, 0));
      g.add(sph(0.20, skin, 0, 1.15, 0));
      g.add(cone(0.22, 0.18, 0x6a5a4a, 0, 1.3, 0));             // 毡帽
      const spear = cyl(0.02, 0.02, 1.7, 0x8a6a3a, 0.36, 0.85, 0); spear.rotation.z = -0.3;
      g.add(spear);
      g.add(cone(0.05, 0.2, 0xd8d8d8, 0.62, 1.68, 0));          // 枪头
      label = "林"; labelColor = "#3a5a9a"; labelY = 1.55;
    },
    // 吴用：黄儒冠 + 羽扇 + 长袍
    wuyong() {
      g.add(cyl(0.26, 0.34, 0.95, 0xb0a03a, 0, 0.48, 0));
      g.add(sph(0.20, skin, 0, 1.1, 0));
      g.add(cyl(0.16, 0.16, 0.12, 0x2a2a2a, 0, 1.28, 0));       // 儒冠
      g.add(box(0.02, 0.34, 0.24, 0xf0e8d0, 0.36, 0.8, 0));     // 羽扇
      label = "吴"; labelColor = "#b0a03a"; labelY = 1.5;
    },
    // 公孙胜：紫道袍 + 法杖（发光宝珠）
    gongsunsheng() {
      g.add(cyl(0.26, 0.34, 0.95, 0x7a4a9a, 0, 0.48, 0));
      g.add(sph(0.20, skin, 0, 1.1, 0));
      g.add(cone(0.2, 0.24, 0x5a3a7a, 0, 1.3, 0));              // 道冠
      g.add(cyl(0.03, 0.03, 1.4, 0x6a4a2a, 0.4, 0.7, 0));       // 法杖杆
      g.add(sph(0.12, 0xb080ff, 0.4, 1.45, 0, { emissive: 0x6a3ac8, emissiveIntensity: 0.8 })); // 发光宝珠
      label = "公"; labelColor = "#7a4a9a"; labelY = 1.55;
    },
    // 燕青：青瘦 + 弓 + 背箭
    yanqing() {
      g.add(cyl(0.18, 0.24, 0.95, 0x3a9a8a, 0, 0.48, 0));
      g.add(sph(0.19, skin, 0, 1.1, 0));
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 12, Math.PI), mat(0x6a4a2a));
      bow.position.set(0.34, 0.85, 0); bow.rotation.z = Math.PI / 2; g.add(bow);
      g.add(box(0.06, 0.4, 0.1, 0x8a6a3a, -0.2, 0.8, 0.18));    // 背箭筒
      label = "燕"; labelColor = "#3a9a8a"; labelY = 1.5;
    },
    // 李逵：红壮 + 双板斧 + 鬃发
    likui() {
      g.add(cyl(0.28, 0.36, 0.9, 0x9a2a2a, 0, 0.45, 0));
      g.add(sph(0.22, skin, 0, 1.05, 0));
      g.add(sph(0.2, 0x1a1a1a, 0, 1.16, 0.06));                 // 鬃发（乱）
      for (const s of [-1, 1]) {                                 // 双板斧
        g.add(cyl(0.025, 0.025, 0.5, 0x6a4a2a, 0.4 * s, 0.7, 0));
        g.add(box(0.05, 0.24, 0.3, 0xc8c8c8, 0.4 * s, 0.98, 0));
      }
      label = "李"; labelColor = "#9a2a2a"; labelY = 1.55;
    },
    // 花荣：橙俊 + 长弓 + 抹额
    huarong() {
      g.add(cyl(0.18, 0.24, 0.95, 0xc8802a, 0, 0.48, 0));
      g.add(sph(0.19, skin, 0, 1.1, 0));
      g.add(box(0.4, 0.05, 0.05, 0xd8b84a, 0, 1.18, 0.12));     // 抹额
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 6, 14, Math.PI), mat(0x5a3a2a));
      bow.position.set(0.34, 0.85, 0); bow.rotation.z = Math.PI / 2; g.add(bow);
      g.add(box(0.05, 0.36, 0.1, 0x8a6a3a, -0.2, 0.8, 0.18));
      label = "花"; labelColor = "#c8802a"; labelY = 1.5;
    },
    // 时迁：灰小 + 蒙面 + 匕首
    shiqian() {
      g.add(cyl(0.16, 0.22, 0.8, 0x555555, 0, 0.4, 0));
      g.add(sph(0.18, 0x666666, 0, 0.95, 0));                   // 蒙面头（灰罩）
      g.add(sph(0.1, skin, 0, 0.93, 0.1));                      // 露出的脸
      g.add(box(0.03, 0.22, 0.06, 0xd8d8d8, 0.28, 0.5, 0));     // 匕首
      label = "时"; labelColor = "#555555"; labelY = 1.3;
    },
  };
  (builders[heroId] || builders.luzhishen)();
  g.add(baseRing(0xffd27a));
  const spr = nameLabel(label, labelColor);
  spr.position.y = labelY;
  g.add(spr);
  g.userData.labelSprite = spr;
  return g;
}

// ============ 守军 / Boss / 哨兵 / 草人模型 ============
export function buildEnemy(defId, kind) {
  const g = new THREE.Group();
  const skin = 0xd8a880;
  if (kind === "boss") {
    // 祝龙：大红魁梧 + 大刀 + 披风 + 金冠
    g.add(cyl(0.42, 0.52, 1.2, 0xa02020, 0, 0.6, 0));
    g.add(sph(0.3, skin, 0, 1.4, 0));
    g.add(cone(0.26, 0.3, 0xffd27a, 0, 1.72, 0));               // 金冠
    g.add(box(0.9, 1.0, 0.06, 0x701010, 0, 0.9, 0.3));          // 披风
    g.add(cyl(0.04, 0.04, 1.6, 0x5a3a2a, 0.56, 0.9, 0));        // 大刀杆
    g.add(box(0.06, 0.6, 0.3, 0xd8d8d8, 0.56, 1.9, 0));         // 大刀头
    g.add(baseRing(0xff4444));
    return g;
  }
  if (kind === "sentry") {
    // 哨兵：提灯
    g.add(cyl(0.18, 0.24, 0.8, 0xb0a03a, 0, 0.4, 0));
    g.add(sph(0.18, skin, 0, 0.95, 0));
    g.add(cyl(0.02, 0.02, 0.9, 0x6a4a2a, 0.26, 0.9, 0));        // 灯杆
    g.add(sph(0.12, 0xffe08a, 0.26, 1.4, 0, { emissive: 0xffc84a, emissiveIntensity: 0.9 })); // 灯笼
    g.add(baseRing(0xffe08a));
    return g;
  }
  if (defId === "spearman") {
    // 枪兵：盾 + 矛
    g.add(cyl(0.22, 0.28, 0.9, 0x6a4a7a, 0, 0.45, 0));
    g.add(sph(0.2, skin, 0, 1.05, 0));
    g.add(box(0.06, 0.5, 0.4, 0x4a3a5a, 0.32, 0.6, 0));         // 盾
    g.add(cyl(0.02, 0.02, 1.5, 0x6a4a2a, -0.3, 0.8, 0));        // 矛
    g.add(baseRing(0x9a5a4a));
    return g;
  }
  // 庄丁（含草人基础）：褐衣 + 短矛
  g.add(cyl(0.2, 0.26, 0.85, 0x8a5a3a, 0, 0.42, 0));
  g.add(sph(0.18, skin, 0, 0.98, 0));
  g.add(cyl(0.02, 0.02, 1.1, 0x6a4a2a, 0.28, 0.7, 0));
  g.add(cone(0.04, 0.14, 0xd8d8d8, 0.28, 1.32, 0));
  g.add(baseRing(0x9a5a4a));
  return g;
}

// ============ 建筑模型 ============
export function buildBuilding(b) {
  const g = new THREE.Group();
  switch (b.type) {
    case "outer_wall": {
      // 木栅栏：3 根尖木桩
      for (let i = -1; i <= 1; i++) {
        g.add(cyl(0.1, 0.12, 0.9, 0x8a6a3a, i * 0.28, 0.45, 0));
        g.add(cone(0.1, 0.2, 0x9a7a4a, i * 0.28, 1.0, 0));
      }
      g.add(box(0.9, 0.12, 0.1, 0x7a5a30, 0, 0.6, 0));          // 横木
      break;
    }
    case "inner_wall": {
      // 石墙：灰块 + 垛口
      g.add(box(0.92, 0.9, 0.92, 0x777777, 0, 0.45, 0));
      for (let i = -1; i <= 1; i++) g.add(box(0.2, 0.2, 0.92, 0x8a8a8a, i * 0.36, 1.0, 0));
      break;
    }
    case "arrow_tower": {
      // 箭塔：基座 + 收分 + 顶台 + 顶
      g.add(box(0.8, 0.7, 0.8, 0x8a5a2a, 0, 0.35, 0));
      g.add(box(0.6, 0.6, 0.6, 0x9a6a3a, 0, 1.0, 0));
      g.add(box(0.95, 0.15, 0.95, 0x6a4a2a, 0, 1.35, 0));       // 顶台
      g.add(cone(0.6, 0.4, 0x7a3a2a, 0, 1.65, 0, 4));            // 攒尖顶
      break;
    }
    case "watchtower": {
      // 瞭望塔：高杆 + 小亭 + 旗
      g.add(cyl(0.12, 0.16, 1.6, 0x5a4a7a, 0, 0.8, 0));
      g.add(box(0.6, 0.5, 0.6, 0x4a6a9a, 0, 1.8, 0));           // 亭
      g.add(cone(0.5, 0.35, 0x3a5a8a, 0, 2.2, 0, 4));
      g.add(cyl(0.02, 0.02, 0.8, 0x6a4a2a, 0, 2.6, 0));         // 旗杆
      g.add(box(0.4, 0.25, 0.02, 0xc8b83a, 0.22, 2.8, 0));      // 旗
      break;
    }
    case "granary": {
      // 粮仓：圆廪 + 草顶
      g.add(cyl(0.5, 0.55, 1.0, 0x9a8a4a, 0, 0.5, 0, 12));
      g.add(cone(0.62, 0.5, 0xc8a83a, 0, 1.25, 0, 12));         // 草顶
      g.add(box(0.2, 0.4, 0.06, 0x6a5a2a, 0, 0.4, 0.5));        // 仓门
      break;
    }
    case "core": {
      // 忠义堂：台基 + 厅身 + 双坡屋顶 + 匾
      g.add(box(1.9, 0.25, 1.9, 0x8a7a5a, 0, 0.12, 0));         // 台基
      g.add(box(1.5, 0.9, 1.5, 0xc8a838, 0, 0.7, 0));           // 厅身
      g.add(box(0.5, 0.5, 0.06, 0x5a3a1a, 0, 0.5, 0.78));       // 门
      // 双坡屋顶（两片斜板）
      const roofMat = mat(0x6a4a2a);
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.2), roofMat);
      r1.position.set(0, 1.35, -0.45); r1.rotation.x = 0.5; g.add(r1);
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.2), roofMat);
      r2.position.set(0, 1.35, 0.45); r2.rotation.x = -0.5; g.add(r2);
      g.add(box(1.9, 0.12, 0.12, 0x5a3a1a, 0, 1.6, 0));         // 正脊
      g.add(box(0.7, 0.25, 0.05, 0x2a2a2a, 0, 1.0, 0.82));      // 匾
      break;
    }
    case "trap": {
      // 陷坑：地刺
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(cone(0.06, 0.3, 0x994444, Math.cos(a) * 0.2, 0.15, Math.sin(a) * 0.2));
      }
      break;
    }
    default:
      g.add(box(0.9, 0.9, 0.9, 0x888888, 0, 0.45, 0));
  }
  return g;
}
