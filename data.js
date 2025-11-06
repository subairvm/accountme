// data.js — shared storage helpers for all pages
const IE_STORAGE_KEY = 'ie_app_v2_multi_data';
const DEFAULT_BANKS = [
  'Axis Bank','State Bank','HDFC Bank','ICICI Bank','Kotak Mahindra','Punjab National',
  'Bank of Baroda','Canara Bank','Yes Bank','IDFC First','Indian Overseas','Union Bank'
];

const DataStore = (()=>{
  function uid(){return 'id_'+Math.random().toString(36).slice(2,9);}
  function nowISO(){return new Date().toISOString();}

  function _load(){
    try{
      const raw = localStorage.getItem(IE_STORAGE_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed.banks) && Array.isArray(parsed.txns)) return parsed;
      }
    }catch(e){console.error('load',e)}
    // fallback
    return {
      banks: DEFAULT_BANKS.map(n=>({id: uid(), name: n})),
      txns: [],
      meta: {createdAt: nowISO()}
    };
  }
  function _save(state){
    localStorage.setItem(IE_STORAGE_KEY, JSON.stringify(state));
  }

  let state = _load();

  // public API
  return {
    getState(){ return JSON.parse(JSON.stringify(state)); },
    saveState(s){ state = s; _save(state); },
    resetToDefault(){ state = {banks: DEFAULT_BANKS.map(n=>({id: uid(), name: n})), txns: [], meta:{createdAt:nowISO()}}; _save(state); },
    exportJSON(){ return JSON.stringify({...state, exportedAt: nowISO()}, null, 2); },
    importFrom(obj){
      if(!obj) return false;
      const banks = Array.isArray(obj.banks)? obj.banks.map(b=>({id: b.id || uid(), name: b.name || 'Unnamed'})) : DEFAULT_BANKS.map(n=>({id: uid(), name: n}));
      const txns = Array.isArray(obj.txns)? obj.txns.map(t=>({
        id: t.id || uid(), date: t.date || new Date().toISOString(), type: (t.type==='expense'?'expense':'income'),
        amount: Number(t.amount) || 0, category: t.category||'', notes: t.notes||'', bankId: banks.some(b=>b.id===t.bankId)? t.bankId : null, meta: t.meta||{}
      })) : [];
      state = {banks, txns, meta: {importedAt: nowISO()}};
      _save(state); return true;
    },

    // banks
    addBank(name){ const b={id:uid(), name: name||'Unnamed'}; state.banks.push(b); _save(state); return b; },
    renameBank(id, name){ const b = state.banks.find(x=>x.id===id); if(b){b.name=name; _save(state); return true} return false; },
    removeBank(id){ state.banks = state.banks.filter(b=>b.id!==id); state.txns.forEach(t=>{ if(t.bankId===id) t.bankId=null; }); _save(state); },

    // transactions
    addTxn(tx){ const t = {...tx, id: uid()}; state.txns.push(t); _save(state); return t; },
    updateTxn(id, patch){ const i=state.txns.findIndex(x=>x.id===id); if(i>=0){ state.txns[i] = {...state.txns[i], ...patch}; _save(state); return true } return false; },
    deleteTxn(id){ state.txns = state.txns.filter(t=>t.id!==id); _save(state); },

    // transfers: creates two txns (expense from -> income to) and links via transferId
    transfer(fromBankId, toBankId, amount, dateISO, notes){
      const tid = uid();
      const amt = Number(amount) || 0;
      if(amt <= 0) return false;
      const d = dateISO || new Date().toISOString();
      const out = {id: uid(), date: d, type: 'expense', amount: amt, category:'Transfer', notes: notes||`Transfer to ${toBankId||'Unassigned'}`, bankId: fromBankId, meta:{transferId:tid}};
      const infl = {id: uid(), date: d, type: 'income', amount: amt, category:'Transfer', notes: notes||`Transfer from ${fromBankId||'Unassigned'}`, bankId: toBankId, meta:{transferId:tid}};
      state.txns.push(out, infl);
      _save(state);
      return {out, infl};
    },

    // utility queries
    totals(){
      const income = state.txns.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
      const expense = state.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
      return {income, expense, net: income-expense};
    },
    balancesPerBank(){
      return state.banks.map(b=>{
        const inc = state.txns.filter(t=>t.bankId===b.id && t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
        const exp = state.txns.filter(t=>t.bankId===b.id && t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
        const count = state.txns.filter(t=>t.bankId===b.id).length;
        return {id: b.id, name: b.name, income: inc, expense: exp, balance: inc-exp, count};
      });
    }
  };
})();

// small helper to format amount
function fmtAmt(n){ n = Number(n)||0; const fixed = (Math.abs(n%1) < 0.000001)? String(Math.round(n)) : n.toFixed(2); return '₹' + fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
