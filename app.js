/**
 * app.js
 * インナーアビリティ 確率ツール メインロジック
 */

'use strict';

// ===================================
// 定数・設定
// ===================================

const GRADE_NAMES = ['レア', 'エピック', 'ユニーク', 'レジェンダリー'];
const GRADE_ORDER = ['レジェンダリー', 'ユニーク', 'エピック', 'レア'];
const GRADE_CLASS = {
  'レジェンダリー': 'grade-legendary',
  'ユニーク': 'grade-unique',
  'エピック': 'grade-epic',
  'レア': 'grade-rare',
};
const GRADE_ICON = {
  'レジェンダリー': 'icon/rank-legendary.png',
  'ユニーク': 'icon/rank-unique.png',
  'エピック': 'icon/rank-epic.png',
  'レア': 'icon/rank-rare.png',
};
const GRADE_ALT = {
  'レジェンダリー': 'L',
  'ユニーク': 'U',
  'エピック': 'E',
  'レア': 'R',
};
const GRADE_IDX = { 'レア': 0, 'エピック': 1, 'ユニーク': 2, 'レジェンダリー': 3 };

// ベース等級選択肢の定義（順序定義）
const BASE_GRADE_OPTIONS = [
  { grade: 'レジェンダリー', icon: GRADE_ICON.レジェンダリー, isAdvance: false },
  { grade: 'ユニーク', icon: GRADE_ICON.ユニーク, isAdvance: false },
  { grade: 'エピック', icon: GRADE_ICON.エピック, isAdvance: false },
  { grade: 'レア', icon: GRADE_ICON.レア, isAdvance: false },
  { grade: 'アドバンスリセット', icon: GRADE_ICON.レジェンダリー, isAdvance: true },
];

// 表示モード定義
const DISPLAY_MODES = [
  { key: 'nProb', label: 'で引く確率(%)', needsN: true, needsP: false },
  { key: 'average', label: '平均値(回)', needsN: false, needsP: false },
  { key: 'median', label: '50%ライン(回)', needsN: false, needsP: false },
  { key: 'nPct', label: 'ライン(回)', needsN: false, needsP: true },
];

// ===================================
// 状態管理
// ===================================

const state = {
  baseGrade: 'レジェンダリー',
  isAdvance: false,
  usefulOnly: false,
  listModeIdx: 0,
  listN: 1,
  listP: 95,
  modalModeIdx: 0,
  modalN: 1,
  modalP: 95,
  // モダル選択中の (abilityId, grade) ペア
  modalAbilityId: null,
  modalGrade: null,
  // モダル内セレクターに表示する行のリスト
  modalRows: [], // [{abilityId, grade, displayName, isFirstOfName}]
};

// ===================================
// 設定の保存と復元 (localStorage)
// ===================================

const SETTINGS_STORAGE_KEY = 'InnerAbilitySettings';

function saveSettings() {
  try {
    const selectedGrade = state.isAdvance ? 'アドバンスリセット' : state.baseGrade;
    const data = {
      selectedGrade,
      usefulOnly: state.usefulOnly,
      listModeIdx: state.listModeIdx,
      listN: state.listN,
      listP: state.listP,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

// ===================================
// 計算ユーティリティ (Decimal.js)
// ===================================

const D = Decimal;

function calcNProb(p, n) {
  if (!p || p <= 0) return null;
  return D(1).minus(D(1).minus(D(p)).pow(D(n))).times(100).toDecimalPlaces(4).toNumber();
}

function calcAverage(p) {
  if (!p || p <= 0) return null;
  return D(1).div(D(p)).toDecimalPlaces(2).toNumber();
}

function calcMedian(p) {
  if (!p || p <= 0) return null;
  return Math.ceil(Math.log(0.5) / Math.log(1 - p));
}

function calcNPct(p, pct) {
  if (!p || p <= 0) return null;
  return Math.ceil(Math.log(1 - pct / 100) / Math.log(1 - p));
}

function calcDisplay(p, modeIdx, n, pct) {
  const mode = DISPLAY_MODES[modeIdx];
  switch (mode.key) {
    case 'nProb': return calcNProb(p, n);
    case 'average': return calcAverage(p);
    case 'median': return calcMedian(p);
    case 'nPct': return calcNPct(p, pct);
  }
  return null;
}

function formatDisplay(val, modeIdx) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  const mode = DISPLAY_MODES[modeIdx];
  if (mode.key === 'nProb') return formatDecimalSpan(val, 4) + ' %';
  if (Number.isInteger(val)) return formatDecimalSpan(val) + ' 回';
  return formatDecimalSpan(val, 2) + ' 回';
}

function formatDecimalSpan(val, precision) {
  const arr = D(val).toFixed(precision).split('.');
  const isDecimal = arr.length > 1;
  return `<span class="int${isDecimal ? ' decint' : ''}">${arr[0]}</span>${isDecimal ? `<span class="dec">.${arr[1]}</span>` : ''}`;
}

// ===================================
// データアクセス
// ===================================

function getRowGradeProbabilities(baseGrade, isAdvance) {
  const bi = GRADE_IDX[baseGrade];
  return isAdvance
    ? ABILITY_DATA['アドバンスオプション等級確率'][bi]
    : ABILITY_DATA['オプション等級確率'][bi];
}

function getOptionProb_row1(ability, baseGrade) {
  return ability.等級別確率[baseGrade] ?? 0;
}

function getOptionProb_row23(ability, baseGrade, isAdvance) {
  const rowGradeProbs = getRowGradeProbabilities(baseGrade, isAdvance);
  if (!rowGradeProbs) return 0;
  let total = D(0);
  GRADE_NAMES.forEach((grade, gi) => {
    const rp = rowGradeProbs[gi];
    if (!rp) return;
    const op = ability.等級別確率[grade] ?? 0;
    total = total.plus(D(rp).times(D(op)));
  });
  return total.toNumber();
}

/**
 * 指定ベース等級でどの行等級にも出現しないか判定
 * （1行目の確率 === 0 かつ 2,3行目の加重確率 === 0）
 */
function isNeverAppears(ability, baseGrade, isAdvance) {
  const p1 = getOptionProb_row1(ability, baseGrade);
  // 1行目はベース等級と同じ等級のみ → rowGrade===baseGradeのときのみ確率あり
  // 2,3行目
  const p23 = getOptionProb_row23(ability, baseGrade, isAdvance);
  return p1 === 0 && p23 === 0;
}

function formatRange(ability, grade) {
  const candidates = ability.等級別候補[grade];
  if (!candidates || candidates.length === 0) return '—';
  const nums = candidates.map(c => c.数値);
  const mn = nums.at(0), mx = nums.at(-1);
  return (mn === mx ? String(mn) : `${mn} ～ ${mx}`) + (ability.isPercentage ? ' %' : '');
}

// ===================================
// グループデータ構築
// ===================================

function buildAbilityGroups() {
  const list = Object.values(ABILITY_LIST).filter(a => a.id !== 0);
  const nameMap = new Map();
  list.forEach(ability => {
    if (!nameMap.has(ability.名前)) nameMap.set(ability.名前, []);
    nameMap.get(ability.名前).push(ability);
  });
  const groups = [];
  const seen = new Set();
  list.forEach(ability => {
    if (!seen.has(ability.名前)) {
      seen.add(ability.名前);
      groups.push({
        name: ability.名前,
        shortName: ability.短縮名,
        abilities: nameMap.get(ability.名前),
        isUseful: ability.isUseful,
      });
    }
  });
  return groups;
}

// ===================================
// DOM生成
// ===================================

function getGradeClass(grade) {
  return GRADE_CLASS[grade] || 'grade-other';
}

function renderAbilityGroup(group) {
  const groupEl = document.createElement('div');
  groupEl.className = 'ability-group';
  groupEl.dataset.useful = group.isUseful ? '1' : '0';
  groupEl.dataset.groupName = group.name;

  // 等級ごとの行（レジェンダリー→レア順）
  const rows = [];
  group.abilities.forEach(ability => {
    GRADE_ORDER.forEach(grade => {
      rows.push({ ability, grade });
    });
  });

  rows.forEach(({ ability, grade }, idx) => {
    const row = document.createElement('div');
    row.className = 'ability-row';
    row.dataset.abilityId = ability.id;
    row.dataset.grade = grade;

    // 名前セル（グループ最初の行だけ表示）
    const nameCell = document.createElement('div');
    nameCell.className = `cell cell-name${idx === 0 ? '' : ' empty-name'}`;
    const nameSpanFull = document.createElement('span');
    nameSpanFull.className = 'name-full';
    nameSpanFull.textContent = group.name;
    const nameSpanShort = document.createElement('span');
    nameSpanShort.className = 'name-short';
    nameSpanShort.textContent = group.shortName || group.name;
    nameCell.appendChild(nameSpanFull);
    nameCell.appendChild(nameSpanShort);
    nameCell.title = group.name;

    // 等級セル（アイコンのみ）
    const gradeCell = document.createElement('div');
    gradeCell.className = 'cell cell-grade';
    const gradeIcon = document.createElement('img');
    gradeIcon.src = GRADE_ICON[grade] || '';
    gradeIcon.className = 'row-grade-icon';
    gradeIcon.alt = GRADE_ALT[grade];
    gradeCell.appendChild(gradeIcon);

    // 数値範囲セル
    const rangeCell = document.createElement('div');
    rangeCell.className = 'cell cell-range';
    rangeCell.setAttribute('data-range', '');

    // 確率セル（1行目）
    const prob1Cell = document.createElement('div');
    prob1Cell.className = 'cell cell-prob1';
    prob1Cell.setAttribute('data-prob1', '');

    // 確率セル（2,3行目）
    const prob23Cell = document.createElement('div');
    prob23Cell.className = 'cell cell-prob23';
    prob23Cell.setAttribute('data-prob23', '');

    row.appendChild(nameCell);
    row.appendChild(gradeCell);
    row.appendChild(rangeCell);
    row.appendChild(prob1Cell);
    row.appendChild(prob23Cell);

    row.addEventListener('click', () => openModal(ability.id, grade));
    groupEl.appendChild(row);
  });

  return groupEl;
}

// ===================================
// リスト更新
// ===================================

function updateListDisplay() {
  const { baseGrade, isAdvance, listModeIdx, listN, listP } = state;

  document.querySelectorAll('.ability-row').forEach(row => {
    const abilityId = Number(row.dataset.abilityId);
    const rowGrade = row.dataset.grade;
    const ability = ABILITY_LIST[abilityId];
    if (!ability) return;

    // 数値範囲
    const rangeCell = row.querySelector('[data-range]');
    if (rangeCell) {
      const rangeText = formatRange(ability, rowGrade);
      if (rangeText !== '—') {
        rangeCell.innerHTML = `<span class="marked">${rangeText}</span>`;
      } else {
        rangeCell.innerHTML = `<span class="prob-na">—</span>`;
      }
    }

    // 1行目確率
    const prob1_raw = (rowGrade === baseGrade) ? getOptionProb_row1(ability, baseGrade) : 0;
    const val1 = calcDisplay(prob1_raw, listModeIdx, listN, listP);
    const prob1Cell = row.querySelector('[data-prob1]');
    if (prob1Cell) {
      if (prob1_raw === 0) {
        prob1Cell.innerHTML = '<span class="prob-na">—</span>';
      } else {
        prob1Cell.innerHTML = `<span class="prob-value"><span class="marked">${formatDisplay(val1, listModeIdx)}</span></span>`;
      }
    }

    // 2,3行目確率（行等級の確率 × そのオプション確率）
    const rowGradeProbs = getRowGradeProbabilities(baseGrade, isAdvance);
    let prob23_raw = 0;
    if (rowGradeProbs) {
      const gi = GRADE_IDX[rowGrade];
      const rp = rowGradeProbs[gi] ?? 0;
      prob23_raw = rp * (ability.等級別確率[rowGrade] ?? 0);
    }
    const val23 = calcDisplay(prob23_raw, listModeIdx, listN, listP);
    const prob23Cell = row.querySelector('[data-prob23]');
    if (prob23Cell) {
      if (prob23_raw === 0) {
        prob23Cell.innerHTML = '<span class="prob-na">—</span>';
      } else {
        prob23Cell.innerHTML = `<span class="prob-value"><span class="marked">${formatDisplay(val23, listModeIdx)}</span></span>`;
      }
    }
  });

  updateHeaderSub();
  applyFilters();
}

function updateHeaderSub() {
  const { listModeIdx, listN, listP } = state;
  const mode = DISPLAY_MODES[listModeIdx];
  let sub = mode.key === "nProb" ? `${listN}回` : (mode.key === "nPct" ? `${listP}%` : "");
  sub = `${sub}${mode.label}`;


  const s1 = document.getElementById('headerSub1');
  const s23 = document.getElementById('headerSub23');
  if (s1) s1.textContent = sub;
  if (s23) s23.textContent = sub;
}

// ===================================
// フィルター
// ===================================

function applyFilters() {
  const { baseGrade, isAdvance, usefulOnly } = state;
  document.querySelectorAll('.ability-group').forEach(groupEl => {
    const isUseful = groupEl.dataset.useful === '1';

    // 有用度フィルター
    if (usefulOnly && !isUseful) {
      groupEl.classList.add('all-hidden');
      return;
    }

    // ベース等級フィルター：グループ内に1行でも表示される行があるか
    let hasVisible = false;
    groupEl.querySelectorAll('.ability-row').forEach(row => {
      const abilityId = Number(row.dataset.abilityId);
      const rowGrade = row.dataset.grade;
      const ability = ABILITY_LIST[abilityId];
      if (!ability) return;

      // この行(rowGrade)がbaseGrade設定で表示意味があるか
      // 1行目: rowGrade===baseGradeかつprob>0
      // 2,3行目: 行等級確率×オプション確率>0
      const rowGradeProbs = getRowGradeProbabilities(baseGrade, isAdvance);
      let visible = false;
      if (rowGrade === baseGrade && getOptionProb_row1(ability, baseGrade) > 0) {
        visible = true;
      }
      if (!visible && rowGradeProbs) {
        const gi = GRADE_IDX[rowGrade];
        const rp = rowGradeProbs[gi] ?? 0;
        const op = ability.等級別確率[rowGrade] ?? 0;
        if (rp > 0 && op > 0) visible = true;
      }

      row.classList.toggle('hidden-row', !visible);
      if (visible) hasVisible = true;
    });

    groupEl.classList.toggle('all-hidden', !hasVisible);

    // グループ内で最初の表示行に名前を出す
    let firstVisible = true;
    groupEl.querySelectorAll('.ability-row').forEach(row => {
      const nameCell = row.querySelector('.cell-name');
      if (!nameCell) return;
      if (row.classList.contains('hidden-row')) return;
      if (firstVisible) {
        nameCell.classList.remove('empty-name');
        firstVisible = false;
      } else {
        nameCell.classList.add('empty-name');
      }
    });
  });
}

// ===================================
// カスタムSELECT (ベース等級)
// ===================================

function initGradeSelect() {
  const btn = document.getElementById('gradeSelectBtn');
  const dropdown = document.getElementById('gradeSelectDropdown');
  const iconEl = document.getElementById('gradeSelectIcon');
  const textEl = document.getElementById('gradeSelectText');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    dropdown.classList.toggle('open', !isOpen);
    btn.classList.toggle('open', !isOpen);
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    btn.classList.remove('open');
  });

  dropdown.querySelectorAll('.cs-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const grade = opt.dataset.grade;

      // アクティブ切替
      dropdown.querySelectorAll('.cs-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');

      // ボタン表示更新
      iconEl.src = opt.querySelector('.cs-opt-icon').src;
      textEl.textContent = grade;

      // 状態更新
      if (grade === 'アドバンスリセット') {
        state.baseGrade = 'レジェンダリー';
        state.isAdvance = true;
      } else {
        state.baseGrade = grade;
        state.isAdvance = false;
      }

      dropdown.classList.remove('open');
      btn.classList.remove('open');

      saveSettings();
      updateListDisplay();
    });
  });
}

// ===================================
// モダル
// ===================================

function buildModalRows() {
  const rows = [];
  document.querySelectorAll('.ability-group:not(.all-hidden) .ability-row:not(.hidden-row)').forEach(row => {
    const abilityId = Number(row.dataset.abilityId);
    const grade = row.dataset.grade;
    const ability = ABILITY_LIST[abilityId];
    if (!ability) return;
    const rangeText = formatRange(ability, grade);
    rows.push({
      ability,
      abilityId,
      grade,
      name: ability.名前,
      shortName: ability.短縮名 || ability.名前,
      rangeText,
    });
  });
  return rows;
}

function updateModalBaseGrade() {
  const iconEl = document.getElementById('modalBaseGradeIcon');
  const textEl = document.getElementById('modalBaseGradeText');
  if (iconEl && textEl) {
    iconEl.src = GRADE_ICON[state.baseGrade] || '';
    textEl.textContent = state.isAdvance ? `${state.baseGrade} ( アドバンスリセット )` : state.baseGrade;
  }
}

function renderModalSelector(rows, activeAbilityId, activeGrade) {
  const wrap = document.getElementById('modalSelectorWrap');
  if (!wrap) return;

  const activeItem = rows.find(r => r.abilityId === activeAbilityId && r.grade === activeGrade) || rows[0];
  if (!activeItem) {
    wrap.innerHTML = '';
    return;
  }

  // #gradeSelectBtn と同じ独自UIセレクト構造を自動生成
  wrap.innerHTML = `
    <span class="modal-label">アビリティ</span>
    <div class="custom-select-wrap modal-custom-select-wrap" id="modalSelectWrap">
      <button class="custom-select-btn modal-select-btn" id="modalSelectBtn" data-grade="${activeItem.grade}" type="button">
        <span class="modal-sel-name-text">
          <span class="name-full">${activeItem.name}</span>
          <span class="name-short">${activeItem.shortName}</span>
        </span>
        <img class="cs-icon modal-opt-icon" src="${GRADE_ICON[activeItem.grade] || ''}" alt="${GRADE_ALT[activeItem.grade]}">
        <span class="modal-sel-range marked">${activeItem.rangeText}</span>
        <span class="cs-arrow">▾</span>
      </button>
      <div class="custom-select-dropdown modal-select-dropdown" id="modalSelectDropdown"></div>
    </div>
  `;

  const btn = document.getElementById('modalSelectBtn');
  const dropdown = document.getElementById('modalSelectDropdown');

  // ボタンクリックで開閉トグル
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !dropdown.classList.contains('open');
    dropdown.classList.toggle('open', willOpen);
    btn.classList.toggle('open', willOpen);
    if (willOpen) {
      const activeOptGroup = dropdown.querySelector('.modal-cs-option.active').parentElement;
      if (activeOptGroup) {
        activeOptGroup.scrollIntoView({ block: 'center' });
      }
    }
  });

  // ドロップダウン内の選択肢を生成
  let currentAbilityId = null;
  let group = null;
  rows.forEach(item => {
    const isCurrentId = currentAbilityId === item.abilityId;

    if (!isCurrentId) {
      currentAbilityId = item.abilityId;
      group = document.createElement('div');
      group.className = `modal-select-group`;
      dropdown.appendChild(group);
    }

    const isFirst = group.children.length === 0;
    const opt = document.createElement('button');
    const isActive = (item.abilityId === activeAbilityId && item.grade === activeGrade);
    opt.type = 'button';
    opt.className = `cs-option modal-cs-option${isActive ? ' active' : ''}${isFirst ? ' first' : ''}`;
    opt.dataset.abilityId = item.abilityId;
    opt.dataset.grade = item.grade;

    opt.innerHTML = `
      <span class="modal-sel-name-text">
        <span class="name-full">${item.name}</span>
        <span class="name-short">${item.shortName}</span>
      </span>
      <img src="${GRADE_ICON[item.grade] || ''}" class="cs-opt-icon modal-opt-icon" alt="${GRADE_ALT[item.grade]}">
      <span class="modal-sel-range marked">${item.rangeText}</span>
    `;

    opt.addEventListener('click', e => {
      e.stopPropagation();
      state.modalAbilityId = item.abilityId;
      state.modalGrade = item.grade;
      dropdown.classList.remove('open');
      btn.classList.remove('open');
      renderModalSelector(rows, item.abilityId, item.grade);
      renderModalBody();
    });

    group.appendChild(opt);
  });
}

function openModal(abilityId, grade) {
  // リスト側の表示モード設定を引き継ぐ
  state.modalModeIdx = state.listModeIdx;
  state.modalN = state.listN;
  state.modalP = state.listP;

  state.modalAbilityId = abilityId;
  state.modalGrade = grade;

  const rows = buildModalRows();
  state.modalRows = rows;

  // 1. ベース等級表示（要素が存在する場合のみ）
  updateModalBaseGrade();

  // 2. 独自UIオプション選択肢（modalSelectorWrapに自動生成）
  renderModalSelector(rows, abilityId, grade);

  // 3. 確率表示切り替え
  updateModalToggleUI();

  // 4. 数値確率表
  renderModalBody();

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  const dropdown = document.getElementById('modalSelectDropdown');
  const btn = document.getElementById('modalSelectBtn');
  if (dropdown) dropdown.classList.remove('open');
  if (btn) btn.classList.remove('open');
}

function renderModalBody() {
  const { modalAbilityId, modalGrade, baseGrade, isAdvance, modalModeIdx, modalN, modalP } = state;
  const ability = ABILITY_LIST[modalAbilityId];
  const body = document.getElementById('modalBody');
  if (!ability) { body.innerHTML = ''; return; }

  const candidates = [...ability.等級別候補[modalGrade]].reverse();

  if (!candidates || candidates.length === 0) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:0.83rem;padding:8px 0;">この等級では出現しません。</p>';
    return;
  }

  // 確率計算
  const prob1_raw = (modalGrade === baseGrade) ? getOptionProb_row1(ability, baseGrade) : 0;
  const rowGradeProbs = getRowGradeProbabilities(baseGrade, isAdvance);
  let prob23_raw = 0;
  if (rowGradeProbs) {
    const gi = GRADE_IDX[modalGrade];
    const rp = rowGradeProbs[gi] ?? 0;
    prob23_raw = rp * (ability.等級別確率[modalGrade] ?? 0);
  }

  const mode = DISPLAY_MODES[modalModeIdx];
  let subLabel = mode.key === "nProb" ? `${modalN}回` : (mode.key === "nPct" ? `${modalP}%` : "");
  subLabel = `${subLabel}${mode.label}`;

  let html = `
    <div class="modal-table-wrap">
      <table class="modal-table">
        <thead>
          <tr>
            <th style="width: 60px">数値</th>
            <th style="width: 120px">オプション内確率</span></th>
            <th>1行目<span>${subLabel}</span></th>
            <th>2,3行目<span>${subLabel}</span></th>
          </tr>
        </thead>
        <tbody>
  `;

  let sumProb = new D(0);
  candidates.forEach(c => {
    sumProb = sumProb.add(c.確率);
    const distPct = (c.確率 * 100).toFixed(0) + '%';
    const sumPct = (sumProb.times(100)).toFixed(0) + '%';
    const p1val = prob1_raw * c.確率;
    const sumP1val = prob1_raw * sumProb;
    const p23val = prob23_raw * c.確率;
    const sumP23val = prob23_raw * sumProb;
    const d1 = calcDisplay(p1val, modalModeIdx, modalN, modalP);
    const sumD1 = calcDisplay(sumP1val, modalModeIdx, modalN, modalP);
    const d23 = calcDisplay(p23val, modalModeIdx, modalN, modalP);
    const sumD23 = calcDisplay(sumP23val, modalModeIdx, modalN, modalP);
    html += `
      <tr>
        <td class="text-bold" style="text-align: center;">${c.数値}</td>
        <td>
          ${distPct} ( ${sumPct} )
        </td>
        <td>
          ${prob1_raw > 0 ? `
            <span>${formatDisplay(d1, modalModeIdx)}</span> 
            <span>( ${formatDisplay(sumD1, modalModeIdx)} )</span>
          ` : '<span class="text-na">—</span>'}
        </td>
        <td>
          ${prob23_raw > 0 ? `
            <span>${formatDisplay(d23, modalModeIdx)}</span> 
            <span>( ${formatDisplay(sumD23, modalModeIdx)} )</span>
          ` : '<span class="text-na">—</span>'}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  body.innerHTML = html;
}

// ===================================
// 表示モード切り替え
// ===================================

function cycleDisplayMode(isModal) {
  if (isModal) {
    state.modalModeIdx = (state.modalModeIdx + 1) % DISPLAY_MODES.length;
    updateModalToggleUI();
    renderModalBody();
  } else {
    state.listModeIdx = (state.listModeIdx + 1) % DISPLAY_MODES.length;
    updateListToggleUI();
    saveSettings();
    updateListDisplay();
  }
}

function updateListToggleUI() {
  const mode = DISPLAY_MODES[state.listModeIdx];
  document.getElementById('displayToggleLabel').textContent = mode.label;
  document.getElementById('paramNWrap').classList.toggle('hidden', !mode.needsN);
  document.getElementById('paramPWrap').classList.toggle('hidden', !mode.needsP);
}

function updateModalToggleUI() {
  const mode = DISPLAY_MODES[state.modalModeIdx];
  document.getElementById('modalDisplayToggleLabel').textContent = mode.label;
  document.getElementById('modalParamNWrap').classList.toggle('hidden', !mode.needsN);
  document.getElementById('modalParamPWrap').classList.toggle('hidden', !mode.needsP);
  // 入力値も同期
  document.getElementById('modalParamN').value = state.modalN;
  document.getElementById('modalParamP').value = state.modalP;
}

// ===================================
// 基礎確率情報テーブル生成
// ===================================

function renderUpgradeProbTable() {
  const wrap = document.getElementById('upgradeProbTableWrap');
  if (!wrap) return;

  const grades = ABILITY_DATA['等級'];
  const probs = ABILITY_DATA['昇級確率'];

  // 昇級先がある等級（確率 > 0）
  const rows = [];
  for (let i = 0; i < grades.length - 1; i++) {
    const fromGrade = grades[i];
    const toGrade = grades[i + 1];
    const prob = probs[i];
    if (prob !== undefined && prob > 0) {
      const probPct = D(prob).times(100).toString() + '%';
      rows.push({ fromGrade, toGrade, probPct });
    }
  }

  let html = `
    <table class="summary-table">
      <thead>
        <tr>
          <th style="width: 36%;">現在の等級</th>
          <th style="width: 36%;">昇級先</th>
          <th style="width: 28%;">昇級確率</th>
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach(({ fromGrade, toGrade, probPct }) => {
    html += `
      <tr data-grade="${fromGrade}">
        <td>
          <span class="summary-grade-cell">
            <img src="${GRADE_ICON[fromGrade] || ''}" class="cs-opt-icon" alt="${GRADE_ALT[fromGrade] || fromGrade}">
            <span>${fromGrade}</span>
          </span>
        </td>
        <td>
          <span class="summary-grade-cell">
            <img src="${GRADE_ICON[toGrade] || ''}" class="cs-opt-icon" alt="${GRADE_ALT[toGrade] || toGrade}">
            <span>${toGrade}</span>
          </span>
        </td>
        <td class="summary-prob-val"><span class="marked">${probPct}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function renderOptionGradeProbTable() {
  const wrap = document.getElementById('optionGradeProbTableWrap');
  if (!wrap) return;

  const grades = ABILITY_DATA['等級'];
  const optProbs = ABILITY_DATA['オプション等級確率'];
  const advProbs = ABILITY_DATA['アドバンスオプション等級確率'];

  const rowConfigs = [
    { label: 'エピック', grade: 'エピック', icon: GRADE_ICON['エピック'], alt: GRADE_ALT['エピック'], probs: optProbs[1] },
    { label: 'ユニーク', grade: 'ユニーク', icon: GRADE_ICON['ユニーク'], alt: GRADE_ALT['ユニーク'], probs: optProbs[2] },
    { label: 'レジェンダリー', grade: 'レジェンダリー', icon: GRADE_ICON['レジェンダリー'], alt: GRADE_ALT['レジェンダリー'], probs: optProbs[3] },
    { label: 'アドバンスリセット', grade: 'レジェンダリー', icon: GRADE_ICON['レジェンダリー'], alt: GRADE_ALT['レジェンダリー'], probs: advProbs ? advProbs[3] : null },
  ];

  let html = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>ベース等級</th>
  `;

  grades.forEach(g => {
    html += `
      <th>
        <span class="summary-grade-cell">
          <img src="${GRADE_ICON[g] || ''}" class="cs-opt-icon" alt="${GRADE_ALT[g] || g}">
          <span>${g}</span>
        </span>
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  rowConfigs.forEach(rc => {
    if (!rc.probs) return;
    html += `
      <tr data-grade="${rc.grade}">
        <td>
          <span class="summary-grade-cell">
            <img src="${rc.icon || ''}" class="cs-opt-icon" alt="${rc.alt || rc.label}">
            <span>${rc.label}</span>
          </span>
        </td>
    `;

    grades.forEach((g, gi) => {
      const p = rc.probs[gi];
      if (p !== undefined && p > 0) {
        const pct = D(p).times(100).toString() + '%';
        html += `<td class="summary-prob-val" data-grade="${g}"><span class="marked">${pct}</span></td>`;
      } else {
        html += `<td class="summary-prob-val"><span class="text-na">—</span></td>`;
      }
    });

    html += `</tr>`;
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ===================================
// 初期化
// ===================================

function initState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
  }

  // 1. 有用度フィルター
  const usefulEl = document.getElementById('usefulFilter');
  if (saved && typeof saved.usefulOnly === 'boolean') {
    state.usefulOnly = saved.usefulOnly;
    if (usefulEl) usefulEl.checked = saved.usefulOnly;
  } else if (usefulEl) {
    state.usefulOnly = usefulEl.checked;
  }

  // 2. ベース等級 & アドバンス
  const validGrades = ['レジェンダリー', 'ユニーク', 'エピック', 'レア', 'アドバンスリセット'];
  let grade = (saved && validGrades.includes(saved.selectedGrade)) ? saved.selectedGrade : 'レジェンダリー';

  const textEl = document.getElementById('gradeSelectText');
  const iconEl = document.getElementById('gradeSelectIcon');
  const dropdown = document.getElementById('gradeSelectDropdown');
  if (textEl) textEl.textContent = grade;
  if (iconEl) iconEl.src = (grade === 'アドバンスリセット' ? GRADE_ICON['レジェンダリー'] : GRADE_ICON[grade]) || '';
  if (dropdown) {
    dropdown.querySelectorAll('.cs-option').forEach(o => {
      o.classList.toggle('active', o.dataset.grade === grade);
    });
  }

  if (grade === 'アドバンスリセット') {
    state.baseGrade = 'レジェンダリー';
    state.isAdvance = true;
  } else {
    state.baseGrade = grade;
    state.isAdvance = false;
  }

  // 3. 表示モード
  if (saved && typeof saved.listModeIdx === 'number' && saved.listModeIdx >= 0 && saved.listModeIdx < DISPLAY_MODES.length) {
    state.listModeIdx = saved.listModeIdx;
  } else {
    state.listModeIdx = 0;
  }

  // 4. n値
  if (saved && typeof saved.listN === 'number' && saved.listN >= 1) {
    state.listN = saved.listN;
  } else {
    state.listN = 1;
  }
  const paramN = document.getElementById('paramN');
  if (paramN) paramN.value = state.listN;

  // 5. p値
  if (saved && typeof saved.listP === 'number' && saved.listP >= 1 && saved.listP <= 99) {
    state.listP = saved.listP;
  } else {
    state.listP = 95;
  }
  const paramP = document.getElementById('paramP');
  if (paramP) paramP.value = state.listP;

  // 表示モードUIの同期
  updateListToggleUI();
}

function init() {
  buildHeader(
    "インナーアビリティ確率表",
    [
      ["GitHub(使い方)", "https://github.com/roclAknn/EV-InnerAbility"]
    ]
  );

  initState();

  // 基礎確率情報テーブル生成
  renderUpgradeProbTable();
  renderOptionGradeProbTable();

  // リスト生成
  const abilityListEl = document.getElementById('abilityList');
  buildAbilityGroups().forEach(group => {
    abilityListEl.appendChild(renderAbilityGroup(group));
  });

  // カスタムSELECT初期化
  initGradeSelect();

  // sticky-barの高さをCSS変数に反映（wrap時に追従）
  const stickyBar = document.getElementById('stickyBar');
  const updateStickyHeight = () => {
    const h = stickyBar.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sticky-actual-h', `${h}px`);
  };
  updateStickyHeight();
  new ResizeObserver(updateStickyHeight).observe(stickyBar);

  // 初期表示
  updateListDisplay();

  // ===== イベントリスナー =====

  // 有用度フィルター
  document.getElementById('usefulFilter').addEventListener('change', e => {
    state.usefulOnly = e.target.checked;
    saveSettings();
    applyFilters();
  });

  // 表示切り替えボタン（リスト）
  document.getElementById('displayToggleBtn').addEventListener('click', () => cycleDisplayMode(false));

  // n入力（リスト）
  document.getElementById('paramN').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v >= 1) {
      state.listN = v;
      saveSettings();
      updateListDisplay();
    }
  });

  // p入力（リスト）
  document.getElementById('paramP').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v >= 1 && v <= 99) {
      state.listP = v;
      saveSettings();
      updateListDisplay();
    }
  });

  // モダル：表示切り替えボタン（リストとは独立）
  document.getElementById('modalDisplayToggleBtn').addEventListener('click', () => cycleDisplayMode(true));

  // モダル：n入力（独立）
  document.getElementById('modalParamN').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v >= 1) { state.modalN = v; renderModalBody(); }
  });

  // モダル：p入力（独立）
  document.getElementById('modalParamP').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v >= 1 && v <= 99) { state.modalP = v; renderModalBody(); }
  });

  // セレクター外クリックで閉じる（グレード選択・モダル選択）
  document.addEventListener('click', () => {
    const modalDropdown = document.getElementById('modalSelectDropdown');
    const modalBtn = document.getElementById('modalSelectBtn');
    if (modalDropdown) modalDropdown.classList.remove('open');
    if (modalBtn) modalBtn.classList.remove('open');
  });

  // モダル閉じる
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // スクロールボタン
  document.getElementById('scrollTopBtn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('scrollBottomBtn').addEventListener('click', () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

document.addEventListener('DOMContentLoaded', init);
