// data.js — shared storage helpers for all pages
const IE_STORAGE_KEY = 'ie_app_v2_multi_data';
const DEFAULT_BANKS = [
  'Axis Bank','State Bank','HDFC Bank','ICICI Bank','Kotak Mahindra','Punjab National',
  'Bank of Baroda','Canara Bank','Yes Bank','IDFC First','Indian Overseas','Union Bank'
];

const DataStore = (() => {
  // utilities
  function uid(){ return 'id_' + Math.random().toString(36).slice(2,9); }
  function nowISO(){ return new Date().toISOString(); }

  // load / save
  function _load(){
    try{
      const raw = localStorage.getItem(IE_STORAGE_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        // be tolerant of older shapes
        if(parsed && Array.isArray(parsed.banks) && Array.isArray(parsed.txns)){
          return parsed;
        }
      }
    }catch(e){
      console.error('DataStore: load error', e);
    }
    // fallback default state
    return {
      banks: DEFAULT_BANKS.map(n => ({ id: uid(), name: n, opening: 0 })),
      txns: [],
      meta: { createdAt: nowISO() }
    };
  }

  function _save(state){
    try{
      localStorage.setItem(IE_STORAGE_KEY, JSON.stringify(state));
    }catch(e){
      console.error('DataStore: save error', e);
    }
  }

  // in-memory state (kept consistent with localStorage)
  let state = _load();

  // public API
  return {
    // low-level
    getRawState(){ return JSON.parse(JSON.stringify(state)); },
    saveState(newState){ state = newState; _save(state); },

    // convenience (keeps backwards-friendly names)
    getState(){ return this.getRawState(); },

    resetToDefault(){
      state = {
        banks: DEFAULT_BANKS.map(n => ({ id: uid(), name: n, opening: 0 })),
        txns: [],
        meta: { createdAt: nowISO() }
      };
      _save(state);
    },

    exportJSON(){
      return JSON.stringify({ ...state, exportedAt: nowISO() }, null, 2);
    },

    importFrom(obj){
      if(!obj) return false;
      const banks = Array.isArray(obj.banks)
        ? obj.banks.map(b => ({ id: b.id || uid(), name: b.name || 'Unnamed', opening: Number(b.opening) || 0 }))
        : DEFAULT_BANKS.map(n => ({ id: uid(), name: n, opening: 0 }));

      const txns = Array.isArray(obj.txns)
        ? obj.txns.map(t => ({
            id: t.id || uid(),
            date: t.date || nowISO(),
            type: (t.type === 'expense' ? 'expense' : t.type === 'income' ? 'income' : (t.type === 'transfer' ? 'transfer' : 'income')),
            amount: Number(t.amount) || 0,
            category: t.category || '',
            notes: t.notes || '',
            bankId: t.bankId || null,
            meta: t.meta || {}
          }))
        : [];

      state = { banks, txns, meta: { importedAt: nowISO() } };
      _save(state);
      return true;
    },

    // banks
    addBank(name, opening){
      const b = { id: uid(), name: name || 'Unnamed', opening: Number(opening) || 0 };
      state.banks.push(b);
      _save(state);
      return b;
    },

    renameBank(id, name){
      const b = state.banks.find(x => x.id === id);
      if(!b) return false;
      b.name = name || b.name;
      _save(state);
      return true;
    },

    removeBank(id){
      state.banks = state.banks.filter(b => b.id !== id);
      // keep txns but nullify bankId to avoid losing data
      state.txns.forEach(t => { if(t.bankId === id) t.bankId = null; });
      _save(state);
    },

    // transactions
    addTxn(tx){
      const t = {
        id: uid(),
        date: tx.date || nowISO(),
        type: tx.type === 'expense' ? 'expense' : tx.type === 'transfer' ? 'transfer' : 'income',
        amount: Number(tx.amount) || 0,
        category: tx.category || '',
        notes: tx.notes || '',
        bankId: tx.bankId || null,
        meta: tx.meta || {}
      };
      state.txns.push(t);
      _save(state);
      return t;
    },

    updateTxn(id, patch){
      const i = state.txns.findIndex(x => x.id === id);
      if(i === -1) return false;
      state.txns[i] = { ...state.txns[i], ...patch };
      _save(state);
      return true;
    },

    deleteTxn(id){
      state.txns = state.txns.filter(t => t.id !== id);
      _save(state);
    },

    /**
     * transfer(fromBankId, toBankId, amount, dateISO, notes)
     * - records a single neutral transaction of type "transfer"
     * - this transaction will not be counted as income or expense in totals
     * - bankId: left null; we store from/to in fromBank/toBank fields
     */
    transfer(fromBankId, toBankId, amount, dateISO, notes){
      const amt = Number(amount) || 0;
      if(amt <= 0) return false;
      const t = {
        id: uid(),
        date: dateISO || nowISO(),
        type: 'transfer',
        amount: amt,
        category: 'Transfer',
        notes: notes || '',
        bankId: null,           // not tied to single bank
        fromBank: fromBankId || null,
        toBank: toBankId || null,
        meta: {}
      };
      state.txns.push(t);
      _save(state);
      return t;
    },

    // calculations / queries
    totals(){
      const income = state.txns.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount), 0);
      const expense = state.txns.filter(t => t.type === 'expense').reduce((s,t) => s + Number(t.amount), 0);
      return { income, expense, net: income - expense };
    },

    /**
     * balancesPerBank()
     * - For each bank, returns income/expense (excluding transfers),
     *   count (transactions related to that bank including transfers),
     *   opening (if present), and computed balance = opening + income - expense
     */
    balancesPerBank(){
      return state.banks.map(b => {
        const inc = state.txns
          .filter(t => t.type === 'income' && t.bankId === b.id)
          .reduce((s,t) => s + Number(t.amount), 0);
        const exp = state.txns
          .filter(t => t.type === 'expense' && t.bankId === b.id)
          .reduce((s,t) => s + Number(t.amount), 0);
        // count txns that are explicitly tied to this bank OR transfers where from/to match
        const count = state.txns.filter(t =>
          (t.bankId && t.bankId === b.id) ||
          (t.type === 'transfer' && (t.fromBank === b.id || t.toBank === b.id))
        ).length;
        const opening = Number(b.opening) || 0;
        const balance = opening + inc - exp;
        return { id: b.id, name: b.name, opening, income: inc, expense: exp, balance, count };
      });
    },

    // low-level accessor for banks/txns if needed
    listBanks(){ return state.banks.map(b => ({ ...b })); },
    listTxns(){ return state.txns.map(t => ({ ...t })); }
  };
})();

// helper: convert DD-MM-YYYY or YYYY-MM-DD or Date input to ISO (yyyy-mm-dd part kept)
function toISO(d){
  if(!d) return new Date().toISOString();
  if(typeof d === 'string'){
    const s = d.trim();
    // dd-mm-yyyy or dd/mm/yyyy
    const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if(m){
      let dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
      if(yy < 100) yy += (yy >= 70 ? 1900 : 2000);
      const dt = new Date(yy, mm - 1, dd);
      if(!isNaN(dt.getTime())) return dt.toISOString();
    }
    // ISO-like yyyy-mm-dd
    const isoTry = new Date(s);
    if(!isNaN(isoTry.getTime())) return isoTry.toISOString();
  }
  if(d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

/* small helpers you can reuse in pages */

// format amount (Indian grouping)
function fmtAmt(n){
  n = Number(n) || 0;
  const fixed = (Math.abs(n % 1) < 0.000001) ? String(Math.round(n)) : n.toFixed(2);
  return '₹' + fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// format ISO date to dd-mm-yyyy for display
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}
