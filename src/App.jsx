import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDu46TGSkqSeDrsBs3UHOMNJX03L-_V-Po",
  authDomain: "moneybook-49125.firebaseapp.com",
  projectId: "moneybook-49125",
  storageBucket: "moneybook-49125.firebasestorage.app",
  messagingSenderId: "682103053596",
  appId: "1:682103053596:web:e5302450d3472e59772ed9"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const DEFAULT_EXP = ["식비","교통비","쇼핑","의료","문화·여가","통신","교육","주거·관리비","기타"];
const DEFAULT_INC = ["급여","부업","이자","기타수입"];
const TARGETS     = ["개인","가족","기타"];
const EXP_TYPES   = ["카드","현금","은행"];
const INC_TYPES   = ["은행입금","현금수입"];

const fmt   = n => n==null?"":Number(n).toLocaleString("ko-KR")+"원";
const fmtM  = n => { if(n==null)return""; const a=Math.abs(n),s=n<0?"-":""; return a>=10000?s+Math.round(a/10000)+"만원":s+a.toLocaleString("ko-KR")+"원"; };
const fmtD  = d => { if(!d)return""; const[,m,v]=d.split("-"); return`${m}/${v}`; };
const today = () => new Date().toISOString().slice(0,10);

function parseCard(txt) {
  const r={};
  const a=txt.match(/금액\s*([\d,]+)원/), p=txt.match(/사용처\s*(.+)/), t=txt.match(/거래시간\s*(\d{2}\/\d{2})/);
  if(a) r.amount=parseInt(a[1].replace(/,/g,""),10);
  if(p) r.memo=p[1].trim();
  if(t) { const[mo,dy]=t[1].split("/"); r.date=`${new Date().getFullYear()}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`; }
  return r;
}

function dlCSV(rows) {
  const hdr=["날짜","구분","유형","카테고리","대상","금액","메모"];
  const body=rows.map(r=>[r.date,r.mode==="income"?"수입":"지출",r.type,r.category,r.mode==="income"?"":(r.target||""),r.amount,r.memo||""]);
  const csv=[hdr,...body].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
  a.download=`가계부_${new Date().toISOString().slice(0,7)}.csv`; a.click();
}

function loadArr(key,def) {
  try { const v=localStorage.getItem(key); if(!v)return def; const p=JSON.parse(v); return Array.isArray(p)&&p.length>0?p:def; } catch{return def;}
}

let _uid=Date.now(); const uid=()=>String(++_uid);
const blankE=(c)=>({mode:"expense",date:today(),type:"카드",   category:c||"식비",target:"개인",amount:"",memo:""});
const blankI=(c)=>({mode:"income", date:today(),type:"은행입금",category:c||"급여",target:"",   amount:"",memo:""});

/* ── 공용 UI ── */
function Row({label,children}){return (<div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,color:"#64748b",minWidth:60,flexShrink:0}}>{label}</span>{children}</div>);}
function Seg({items,value,onChange,ac}){return (<div style={{display:"flex",gap:5,flex:1,flexWrap:"wrap"}}>{items.map(t=><button key={t} onClick={()=>onChange(t)} style={{flex:1,minWidth:44,padding:"8px 4px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap",border:value===t?`1.5px solid ${ac.b}`:"1.5px solid #e2e8f0",background:value===t?ac.bg:"#f8fafc",color:value===t?ac.c:"#94a3b8"}}>{t}</button>)}</div>);}

/* ── 카테고리 행 (완전 독립 컴포넌트) ── */
function CatRow({cat, onEdit, onDelete}){
  return <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"#f8fafc",borderRadius:8,border:"1px solid #f1f5f9"}}>
    <span style={{flex:1,fontSize:13,color:"#1e293b",fontWeight:500}}>{cat}</span>
    <button onClick={onEdit}   style={Sc.cbEdit}>수정</button>
    <button onClick={onDelete} style={Sc.cbDel}>삭제</button>
  </div>;
}

/* ── 카테고리 수정 행 (완전 독립 컴포넌트, 자체 input state) ── */
function CatEditRow({initVal, onSave, onCancel}){
  const [val,setVal]=useState(initVal);
  return <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"#eff6ff",borderRadius:8,border:"1.5px solid #93c5fd"}}>
    <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
      onKeyDown={e=>{if(e.key==="Enter")onSave(val);if(e.key==="Escape")onCancel();}}
      style={{flex:1,background:"#fff",border:"1.5px solid #93c5fd",borderRadius:6,color:"#1e293b",padding:"5px 9px",fontSize:13,outline:"none"}}/>
    <button onClick={()=>onSave(val)} style={Sc.cbSave}>저장</button>
    <button onClick={onCancel}        style={Sc.cbCancel}>취소</button>
  </div>;
}

/* ── 카테고리 추가 행 (완전 독립 컴포넌트, 자체 input state) ── */
function CatAddRow({onAdd, acColor}){
  const [val,setVal]=useState("");
  return <div style={{display:"flex",gap:8,marginTop:4}}>
    <input type="text" placeholder="새 카테고리 이름" value={val} onChange={e=>setVal(e.target.value)}
      onKeyDown={e=>{if(e.key==="Enter"){onAdd(val);setVal("");}}}
      style={{flex:1,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:9,color:"#1e293b",padding:"9px 12px",fontSize:14,outline:"none"}}/>
    <button onClick={()=>{onAdd(val);setVal("");}} style={{background:acColor,color:"#fff",border:"none",borderRadius:9,padding:"9px 16px",fontSize:14,fontWeight:700,cursor:"pointer",flexShrink:0}}>추가</button>
  </div>;
}

/* ── CSV 업로드 페이지 ── */
function UploadPage({onImport, onBack, showToast}){
  const [preview, setPreview] = useState(null); // 파싱된 행 배열
  const [fileName, setFileName] = useState("");
  let _id = Date.now();
  const newUid = () => String(++_id);

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length < 2) return [];
    // 헤더 skip (첫 줄)
    return lines.slice(1).map(line=>{
      // 쌍따옴표 처리
      const cols = [];
      let cur="", inQ=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(ch==='"'){ inQ=!inQ; continue; }
        if(ch===','&&!inQ){ cols.push(cur.trim()); cur=""; continue; }
        cur+=ch;
      }
      cols.push(cur.trim());
      const [date,구분,type,category,target,amountRaw,memo] = cols;
      const amount = parseInt((amountRaw||"").replace(/,/g,""), 10);
      if(!date||!구분||isNaN(amount)) return null;
      return {
        id: newUid(),
        mode: 구분==="수입"?"income":"expense",
        date: date.trim(),
        type: (type||"").trim(),
        category: (category||"").trim(),
        target: (target||"").trim(),
        amount,
        memo: (memo||"").trim(),
      };
    }).filter(Boolean);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      // BOM 제거
      const text = ev.target.result.replace(/^\uFEFF/,"");
      const rows = parseCSV(text);
      if(rows.length===0) return showToast("파싱 실패 — 포맷을 확인하세요");
      setPreview(rows);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = () => {
    if(!preview||preview.length===0) return;
    onImport(preview);
    showToast(`${preview.length}건 가져오기 완료 ✓`);
    onBack();
  };

  const fmt = n => n==null?"":Number(n).toLocaleString("ko-KR")+"원";

  return <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",flexDirection:"column"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",background:"#fff",borderBottom:"1px solid #f1f5f9",position:"sticky",top:0,zIndex:10}}>
      <span style={{fontSize:16,fontWeight:800,color:"#1e293b"}}>📂 데이터 가져오기</span>
      <button onClick={onBack} style={{background:"#f1f5f9",border:"none",color:"#64748b",borderRadius:8,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600}}>← 닫기</button>
    </div>

    <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:16}}>
      {/* 포맷 안내 */}
      <div style={{background:"#f0f9ff",borderRadius:12,padding:"14px 16px",border:"1px dashed #93c5fd"}}>
        <div style={{fontSize:12,color:"#2563eb",fontWeight:700,marginBottom:8}}>📋 CSV 파일 포맷</div>
        <div style={{fontSize:12,color:"#475569",lineHeight:1.8}}>
          <div>• 앱에서 다운로드한 CSV를 그대로 올려도 돼요</div>
          <div>• 직접 만들 경우 아래 헤더 순서를 지켜주세요</div>
        </div>
        <pre style={{fontSize:11,color:"#64748b",marginTop:8,lineHeight:1.7,overflowX:"auto"}}>
{`날짜,구분,유형,카테고리,대상,금액,메모
2025-04-24,지출,카드,식비,개인,19000,NHN링크
2025-04-01,수입,은행입금,급여,,3000000,4월급여`}
        </pre>
      </div>

      {/* 파일 선택 */}
      <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,padding:"28px",background:"#fff",borderRadius:12,border:"2px dashed #e2e8f0",cursor:"pointer"}}>
        <span style={{fontSize:32}}>📁</span>
        <span style={{fontSize:14,color:"#475569",fontWeight:600}}>{fileName||"CSV 파일 선택"}</span>
        <span style={{fontSize:12,color:"#94a3b8"}}>탭해서 파일 선택</span>
        <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{display:"none"}}/>
      </label>

      {/* 미리보기 */}
      {preview && <>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:14,fontWeight:700,color:"#1e293b"}}>미리보기 ({preview.length}건)</span>
          <button onClick={()=>{setPreview(null);setFileName("");}} style={{background:"none",border:"none",color:"#94a3b8",fontSize:12,cursor:"pointer"}}>초기화</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:340,overflowY:"auto"}}>
          {preview.map((r,i)=>(
            <div key={i} style={{background:"#fff",borderRadius:10,padding:"10px 12px",border:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{display:"flex",gap:4,marginBottom:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,borderRadius:4,padding:"2px 6px",fontWeight:600,background:r.mode==="income"?"#f0fdf4":"#fef2f2",color:r.mode==="income"?"#16a34a":"#dc2626"}}>{r.mode==="income"?"수입":"지출"}</span>
                  <span style={{fontSize:10,borderRadius:4,padding:"2px 6px",background:"#f1f5f9",color:"#64748b"}}>{r.category}</span>
                  {r.target&&<span style={{fontSize:10,borderRadius:4,padding:"2px 6px",background:"#fffbeb",color:"#d97706"}}>{r.target}</span>}
                </div>
                <div style={{fontSize:12,color:"#475569"}}>{r.date} · {r.memo||"—"}</div>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:r.mode==="income"?"#16a34a":"#dc2626",textAlign:"right"}}>
                {r.mode==="income"?"+":"-"}{fmt(r.amount)}
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleImport}
          style={{background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",width:"100%"}}>
          ✅ {preview.length}건 가져오기
        </button>
      </>}
    </div>
  </div>;
}

/* ── 설정 화면 ── */
function SettingsPage({expCats,setExpCats,incCats,setIncCats,onBack,showToast}){
  const [editIdx,setEditIdx]=useState(null); // {type,idx}

  const doEdit=(type,idx,val)=>{
    const v=val.trim(); if(!v)return;
    if(type==="exp"){const n=[...expCats];n[idx]=v;setExpCats(n);}
    else            {const n=[...incCats];n[idx]=v;setIncCats(n);}
    setEditIdx(null); showToast("수정됨 ✓");
  };
  const doDelete=(type,idx)=>{
    if(type==="exp"){if(expCats.length<=1)return showToast("최소 1개 필요");setExpCats(expCats.filter((_,i)=>i!==idx));}
    else            {if(incCats.length<=1)return showToast("최소 1개 필요");setIncCats(incCats.filter((_,i)=>i!==idx));}
    showToast("삭제됨");
  };
  const doAdd=(type,val)=>{
    const v=val.trim(); if(!v)return;
    if(type==="exp"){if(expCats.includes(v))return showToast("이미 있어요");setExpCats([...expCats,v]);}
    else            {if(incCats.includes(v))return showToast("이미 있어요");setIncCats([...incCats,v]);}
    showToast("추가됨 ✓");
  };

  return <div style={{minHeight:"100vh",background:"#f8fafc",display:"flex",flexDirection:"column"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",background:"#fff",borderBottom:"1px solid #f1f5f9",position:"sticky",top:0,zIndex:10}}>
      <span style={{fontSize:16,fontWeight:800,color:"#1e293b"}}>⚙️ 카테고리 설정</span>
      <button onClick={onBack} style={{background:"#f1f5f9",border:"none",color:"#64748b",borderRadius:8,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600}}>← 닫기</button>
    </div>
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:10,paddingBottom:60}}>
      
      <div style={{fontSize:12,color:"#64748b",fontWeight:700,letterSpacing:0.5,marginTop:4}}>💸 지출 카테고리</div>
      {expCats.map((c,i)=>(
        editIdx?.type==="exp"&&editIdx.idx===i
          ? <CatEditRow key={`exp-edit-${i}`} initVal={c} onSave={v=>doEdit("exp",i,v)} onCancel={()=>setEditIdx(null)}/>
          : <CatRow    key={`exp-${i}`}       cat={c}     onEdit={()=>setEditIdx({type:"exp",idx:i})} onDelete={()=>doDelete("exp",i)}/>
      ))}
      <CatAddRow onAdd={v=>doAdd("exp",v)} acColor="#2563eb"/>

      <div style={{borderTop:"1px solid #f1f5f9",marginTop:8,paddingTop:16,fontSize:12,color:"#64748b",fontWeight:700,letterSpacing:0.5}}>💰 수입 카테고리</div>
      {incCats.map((c,i)=>(
        editIdx?.type==="inc"&&editIdx.idx===i
          ? <CatEditRow key={`inc-edit-${i}`} initVal={c} onSave={v=>doEdit("inc",i,v)} onCancel={()=>setEditIdx(null)}/>
          : <CatRow    key={`inc-${i}`}       cat={c}     onEdit={()=>setEditIdx({type:"inc",idx:i})} onDelete={()=>doDelete("inc",i)}/>
      ))}
      <CatAddRow onAdd={v=>doAdd("inc",v)} acColor="#16a34a"/>

      <div style={{borderTop:"1px solid #f1f5f9",marginTop:8,paddingTop:16,textAlign:"center"}}>
        <button onClick={()=>{if(!confirm("기본값으로 초기화할까요?"))return;setExpCats(DEFAULT_EXP);setIncCats(DEFAULT_INC);showToast("초기화됨");}}
          style={{background:"none",border:"1px solid #e2e8f0",color:"#94a3b8",borderRadius:8,padding:"8px 16px",fontSize:12,cursor:"pointer"}}>
          🔄 기본값으로 초기화
        </button>
      </div>
    </div>
  </div>;
}

/* ── 지출 화면 ── */
function ExpPage({expCats,onSave,editData,onCancel,showToast}){
  const [tab,setTab]=useState("manual");
  const [form,setForm]=useState(editData||blankE(expCats[0]));
  const [paste,setPaste]=useState("");
  const [parsed,setParsed]=useState(null);
  const [ps,setPs]=useState("idle");
  const prev=useRef(null);
  useEffect(()=>{if(editData&&editData!==prev.current){setForm(editData);setTab("manual");prev.current=editData;}},[editData]);
  const blue={bg:"#eff6ff",b:"#3b82f6",c:"#2563eb"}, yel={bg:"#fffbeb",b:"#f59e0b",c:"#d97706"};
  const doSave=()=>{if(!form.amount||isNaN(form.amount))return showToast("금액을 입력하세요");onSave({...form,amount:Number(form.amount)});setForm(blankE(expCats[0]));setPaste("");setParsed(null);setPs("idle");};
  const doParse=()=>{setPs("loading");setTimeout(()=>{const r=parseCard(paste);if(!r.amount){setPs("idle");return showToast("파싱 실패");}setParsed(r);setForm(f=>({...f,date:r.date||f.date,type:"카드",amount:r.amount,memo:r.memo||""}));setPs("done");setTimeout(()=>setPs("idle"),2000);},600);};
  return <div>
    <div style={S.subBar}>
      <button onClick={()=>{setTab("manual");setPaste("");setParsed(null);}} style={{...S.subBtn,...(tab==="manual"?S.subOn:{})}}>✏️ 수동 입력</button>
      <button onClick={()=>setTab("paste")} style={{...S.subBtn,...(tab==="paste"?S.subOn:{})}}>📩 문자 붙여넣기</button>
    </div>
    {tab==="manual"&&<div style={S.form}>
      <div style={S.ft}>{editData?"✏️ 지출 수정":"💸 지출 입력"}</div>
      <Row label="날짜"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={S.inp}/></Row>
      <Row label="유형"><Seg items={EXP_TYPES} value={form.type} onChange={v=>setForm({...form,type:v})} ac={blue}/></Row>
      <Row label="카테고리"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} style={S.inp}>{expCats.map(c=><option key={c}>{c}</option>)}</select></Row>
      <Row label="대상"><Seg items={TARGETS} value={form.target} onChange={v=>setForm({...form,target:v})} ac={yel}/></Row>
      <Row label="금액"><input type="number" placeholder="숫자만" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} style={S.inp}/></Row>
      <Row label="메모"><input type="text" placeholder="사용처·메모" value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})} style={S.inp}/></Row>
      <button onClick={doSave} style={S.saveBtn}>{editData?"수정 저장":"저장"}</button>
      {editData&&<button onClick={onCancel} style={S.cancelBtn}>취소</button>}
    </div>}
    {tab==="paste"&&<div style={S.form}>
      <div style={S.ft}>📩 카드 문자 붙여넣기</div>
      <div style={S.exBox}><div style={S.exL}>하나카드 형식 예시</div><pre style={S.exP}>{"금액 19,000원\n카드 하나2*0*\n사용처 NHN링크\n거래시간 04/24 11:19"}</pre></div>
      <textarea value={paste} onChange={e=>{setPaste(e.target.value);setParsed(null);}} placeholder="여기에 문자 붙여넣기..." style={S.ta}/>
      <button onClick={doParse} disabled={ps==="loading"} style={{...S.saveBtn,background:ps==="done"?"#16a34a":ps==="loading"?"#94a3b8":"#0f766e"}}>
        {ps==="loading"?"⏳ 분석 중...":ps==="done"?"✅ 파싱 완료!":"🔍 파싱하기"}
      </button>
      {parsed&&<div style={S.preview}>
        <div style={{fontSize:13,color:"#2563eb",fontWeight:700}}>✅ 파싱 완료 — 카테고리·대상 선택 후 저장</div>
        <Row label="날짜"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={S.inp}/></Row>
        <Row label="금액"><input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} style={S.inp}/></Row>
        <Row label="사용처"><input type="text" value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})} style={S.inp}/></Row>
        <Row label="카테고리"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} style={S.inp}>{expCats.map(c=><option key={c}>{c}</option>)}</select></Row>
        <Row label="대상"><Seg items={TARGETS} value={form.target} onChange={v=>setForm({...form,target:v})} ac={yel}/></Row>
        <button onClick={doSave} style={S.saveBtn}>저장</button>
      </div>}
    </div>}
  </div>;
}

/* ── 수입 화면 ── */
function IncPage({incCats,onSave,editData,onCancel,showToast}){
  const [form,setForm]=useState(editData||blankI(incCats[0]));
  const prev=useRef(null);
  useEffect(()=>{if(editData&&editData!==prev.current){setForm(editData);prev.current=editData;}},[editData]);
  const grn={bg:"#f0fdf4",b:"#22c55e",c:"#16a34a"};
  const doSave=()=>{if(!form.amount||isNaN(form.amount))return showToast("금액을 입력하세요");onSave({...form,amount:Number(form.amount)});setForm(blankI(incCats[0]));};
  return <div style={S.form}>
    <div style={S.ft}>{editData?"✏️ 수입 수정":"💰 수입 입력"}</div>
    <Row label="날짜"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={S.inp}/></Row>
    <Row label="유형"><Seg items={INC_TYPES} value={form.type} onChange={v=>setForm({...form,type:v})} ac={grn}/></Row>
    <Row label="카테고리"><Seg items={incCats} value={form.category} onChange={v=>setForm({...form,category:v})} ac={grn}/></Row>
    <Row label="금액"><input type="number" placeholder="숫자만" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} style={S.inp}/></Row>
    <Row label="메모"><input type="text" placeholder="출처·메모" value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})} style={S.inp}/></Row>
    <button onClick={doSave} style={{...S.saveBtn,background:"#16a34a"}}>{editData?"수정 저장":"저장"}</button>
    {editData&&<button onClick={onCancel} style={S.cancelBtn}>취소</button>}
  </div>;
}

/* ── 메인 ── */
export default function App(){
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expCats, setExpCats] = useState(()=>loadArr("mb7_exp",DEFAULT_EXP));
  const [incCats, setIncCats] = useState(()=>loadArr("mb7_inc",DEFAULT_INC));
  const [page,    setPage]    = useState("home");
  const [iMode,   setIMode]   = useState("expense");
  const [editRec, setEditRec] = useState(null);
  const [fMonth,  setFMonth]  = useState(()=>{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [fTarget, setFTarget] = useState("전체");
  const [toast,   setToast]   = useState("");

  // Firestore 실시간 구독
  useEffect(()=>{
    const q = query(collection(db,"records"), orderBy("date","desc"));
    const unsub = onSnapshot(q, snap=>{
      setRecords(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    });
    return unsub;
  },[]);

  // 카테고리는 localStorage 유지
  useEffect(()=>{localStorage.setItem("mb7_exp",JSON.stringify(expCats));},[expCats]);
  useEffect(()=>{localStorage.setItem("mb7_inc",JSON.stringify(incCats));},[incCats]);

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2200);};

  const handleSave=async data=>{
    if(editRec){
      await updateDoc(doc(db,"records",editRec.id), data);
      showToast("수정 완료 ✓");
    } else {
      await addDoc(collection(db,"records"), data);
      showToast("저장 완료 ✓");
    }
    setEditRec(null); setPage("home");
  };

  const handleDel=async id=>{
    if(!confirm("삭제할까요?"))return;
    await deleteDoc(doc(db,"records",id));
    showToast("삭제됨");
  };

  const startEdit=r=>{setEditRec(r);setIMode(r.mode||"expense");setPage("input");};

  const sorted  =[...records].sort((a,b)=>a.date<b.date?1:-1);
  const filtered=sorted.filter(r=>r.date?.startsWith(fMonth)&&(fTarget==="전체"||r.target===fTarget));
  const income  =filtered.filter(r=>r.mode==="income") .reduce((s,r)=>s+Number(r.amount||0),0);
  const expense =filtered.filter(r=>r.mode==="expense").reduce((s,r)=>s+Number(r.amount||0),0);
  const mRecs=sorted.filter(r=>r.date?.startsWith(fMonth));
  const mExp=mRecs.filter(r=>r.mode==="expense"), mInc=mRecs.filter(r=>r.mode==="income");
  const mET=mExp.reduce((s,r)=>s+Number(r.amount),0), mIT=mInc.reduce((s,r)=>s+Number(r.amount),0);
  const cStat=expCats.map(c=>({l:c,t:mExp.filter(r=>r.category===c).reduce((s,r)=>s+Number(r.amount),0)})).filter(x=>x.t>0).sort((a,b)=>b.t-a.t);
  const tStat=TARGETS.map(t=>({l:t,t:mExp.filter(r=>r.target===t).reduce((s,r)=>s+Number(r.amount),0)}));
  const iStat=incCats.map(c=>({l:c,t:mInc.filter(r=>r.category===c).reduce((s,r)=>s+Number(r.amount),0)})).filter(x=>x.t>0);

  const tc=r=>{
    if(r.mode==="income")return{bg:"#f0fdf4",c:"#16a34a",b:"#86efac"};
    if(r.type==="카드")  return{bg:"#eff6ff",c:"#2563eb",b:"#93c5fd"};
    if(r.type==="현금")  return{bg:"#fffbeb",c:"#d97706",b:"#fcd34d"};
    if(r.type==="은행")  return{bg:"#f5f3ff",c:"#7c3aed",b:"#c4b5fd"};
    return{bg:"#f1f5f9",c:"#64748b",b:"#cbd5e1"};
  };

  /* 설정 페이지 */
  if(loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontSize:16,color:"#94a3b8"}}>불러오는 중...</div>;
  if(page==="settings") return <SettingsPage expCats={expCats} setExpCats={setExpCats} incCats={incCats} setIncCats={setIncCats} onBack={()=>setPage("home")} showToast={showToast}/>;
  if(page==="upload")   return <UploadPage onImport={async rows=>{ for(const r of rows){ const {id:_,...data}=r; await addDoc(collection(db,"records"),data); } showToast(`${rows.length}건 가져오기 완료 ✓`); setPage("home"); }} onBack={()=>setPage("home")} showToast={showToast}/>;

  return <div style={S.root}>
    <header style={S.header}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={S.logo}>₩</div>
        <span style={{fontSize:18,fontWeight:800,letterSpacing:-0.5,color:"#1e293b"}}>가계부</span>
      </div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={()=>setPage("upload")}   style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>📂</button>
        <button onClick={()=>setPage("settings")} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>⚙️</button>
      </div>
    </header>

    {/* 홈 */}
    {page==="home"&&<>
      <div style={S.filterBar}>
        <input type="month" value={fMonth} onChange={e=>setFMonth(e.target.value)} style={S.mInput}/>
        <select value={fTarget} onChange={e=>setFTarget(e.target.value)} style={S.sel}>{["전체",...TARGETS].map(t=><option key={t}>{t}</option>)}</select>
      </div>
      <div style={S.sumRow}>
        {[["수입",income,"#22c55e","#16a34a"],["지출",expense,"#ef4444","#dc2626"],["잔액",income-expense,"#3b82f6",income-expense>=0?"#2563eb":"#dc2626"]].map(([l,v,bc,tc2])=>(
          <div key={l} style={{...S.sumCard,borderTop:`3px solid ${bc}`}}>
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:5,fontWeight:500}}>{l}</div>
            <div style={{fontSize:16,fontWeight:800,color:tc2}}>{fmtM(v)}</div>
          </div>
        ))}
      </div>
      <div style={S.listArea}>
        <div style={{display:"flex",justifyContent:"space-between",padding:"4px 2px"}}>
          <span style={{fontSize:12,color:"#94a3b8"}}>{filtered.length}건</span>
          <span style={{fontSize:13,color:"#dc2626",fontWeight:700}}>지출합계 {fmt(expense)}</span>
        </div>
        {filtered.length===0&&<div style={S.empty}><div style={{fontSize:36,marginBottom:8}}>🗒️</div><div>내역이 없어요</div></div>}
        {filtered.map(r=>{const t=tc(r);return (<div key={r.id} style={S.card}>
          <div style={S.cDate}><div style={{fontSize:20,fontWeight:800,lineHeight:1,color:"#1e293b"}}>{fmtD(r.date).split("/")[1]}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{fmtD(r.date).split("/")[0]}월</div></div>
          <div style={{flex:1,overflow:"hidden"}}>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
              <span style={{...S.badge,background:r.mode==="income"?"#f0fdf4":"#fef2f2",color:r.mode==="income"?"#16a34a":"#dc2626",border:`1px solid ${r.mode==="income"?"#86efac":"#fca5a5"}`}}>{r.mode==="income"?"수입":"지출"}</span>
              <span style={{...S.badge,background:t.bg,color:t.c,border:`1px solid ${t.b}`}}>{r.type}</span>
              <span style={{...S.badge,background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0"}}>{r.category}</span>
              {r.mode==="expense"&&r.target&&<span style={{...S.badge,background:"#fffbeb",color:"#d97706",border:"1px solid #fcd34d"}}>{r.target}</span>}
            </div>
            <div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#475569"}}>{r.memo||"—"}</div>
          </div>
          <div style={{textAlign:"right",minWidth:90}}>
            <div style={{fontSize:15,fontWeight:800,color:r.mode==="income"?"#16a34a":"#dc2626"}}>{r.mode==="income"?"+":"-"}{fmt(r.amount)}</div>
            <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:5}}>
              <button onClick={()=>startEdit(r)} style={S.editBtn}>수정</button>
              <button onClick={()=>handleDel(r.id)} style={S.delBtn}>삭제</button>
            </div>
          </div>
        </div>);})}
      </div>
    </>}

    {/* 입력 */}
    {page==="input"&&<div>
      <div style={S.modeBar}>
        <button onClick={()=>{setIMode("expense");setEditRec(null);}} style={{...S.modeBtn,...(iMode==="expense"?{color:"#dc2626",borderBottom:"3px solid #ef4444",background:"#fff5f5"}:{})}}>💸 지출</button>
        <button onClick={()=>{setIMode("income"); setEditRec(null);}} style={{...S.modeBtn,...(iMode==="income" ?{color:"#16a34a",borderBottom:"3px solid #22c55e",background:"#f0fdf4"}:{})}}>💰 수입</button>
      </div>
      {iMode==="expense"&&<ExpPage expCats={expCats} onSave={handleSave} editData={editRec?.mode==="expense"?editRec:null} onCancel={()=>setEditRec(null)} showToast={showToast}/>}
      {iMode==="income" &&<IncPage incCats={incCats} onSave={handleSave} editData={editRec?.mode==="income" ?editRec:null} onCancel={()=>setEditRec(null)} showToast={showToast}/>}
    </div>}

    {/* 통계 */}
    {page==="stats"&&<div>
      <div style={{padding:"14px 20px 10px"}}><input type="month" value={fMonth} onChange={e=>setFMonth(e.target.value)} style={{...S.mInput,width:"100%",boxSizing:"border-box"}}/></div>
      <div style={{display:"flex",background:"#fff",margin:"0 16px 16px",borderRadius:14,padding:"16px 12px",boxShadow:"0 1px 4px #0000000d"}}>
        {[["수입",mIT,"#16a34a"],["지출",mET,"#dc2626"],["잔액",mIT-mET,mIT-mET>=0?"#2563eb":"#dc2626"]].map(([l,v,c])=>(
          <div key={l} style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>{l}</div><div style={{fontSize:16,fontWeight:800,color:c}}>{fmt(v)}</div></div>
        ))}
      </div>
      {[{title:"📂 지출 — 카테고리별",rows:cStat,total:mET,grad:"#3b82f6,#8b5cf6"},{title:"👤 지출 — 대상별",rows:tStat,total:mET,grad:"#f59e0b,#ef4444"},{title:"💰 수입 — 카테고리별",rows:iStat,total:mIT,grad:"#22c55e,#06b6d4"}].map(sec=>(
        <div key={sec.title} style={{padding:"0 20px 20px"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#475569",marginBottom:14}}>{sec.title}</div>
          {sec.rows.filter(x=>x.t>0).length===0&&<div style={{fontSize:13,color:"#94a3b8"}}>내역 없음</div>}
          {sec.rows.filter(x=>x.t>0).map(({l,t})=>{const pct=sec.total?Math.round(t/sec.total*100):0;return (<div key={l} style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",marginBottom:6}}><span style={{flex:1,fontSize:13,color:"#1e293b",fontWeight:500}}>{l}</span><span style={{fontSize:11,color:"#94a3b8",marginRight:8}}>{pct}%</span><span style={{fontSize:13,fontWeight:700,color:"#1e293b",minWidth:80,textAlign:"right"}}>{fmt(t)}</span></div>
            <div style={{height:8,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${sec.grad})`,borderRadius:4,transition:"width .4s"}}/></div>
          </div>);})}
        </div>
      ))}
      <div style={{padding:"0 20px 20px",display:"flex",flexDirection:"column",gap:10}}>
        <button onClick={()=>dlCSV(mRecs)} style={{...S.saveBtn,background:"#0f766e"}}>
          📥 이번 달({fMonth.replace("-","년 ")}월) 다운로드
        </button>
        <button onClick={()=>dlCSV(sorted)} style={{...S.saveBtn,background:"#475569"}}>
          📦 전체 내역 다운로드
        </button>
      </div>
    </div>}

    <nav style={S.nav}>
      {[["home","🏠","홈"],["input","➕","입력"],["stats","📊","통계"]].map(([key,icon,label])=>(
        <button key={key} onClick={()=>{setPage(key);if(key!=="input")setEditRec(null);}}
          style={{...S.navBtn,...(page===key?{color:"#2563eb",borderTop:"2px solid #3b82f6"}:{})}}>
          <span style={{fontSize:key==="input"?26:20}}>{icon}</span>
          <span style={{fontSize:11,fontWeight:600}}>{label}</span>
        </button>
      ))}
    </nav>
    {toast&&<div style={S.toast}>{toast}</div>}
  </div>;
}

const S={
  root:    {minHeight:"100vh",background:"#f8fafc",color:"#1e293b",fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif",maxWidth:480,margin:"0 auto",paddingBottom:120},
  header:  {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px 12px",background:"#fff",borderBottom:"1px solid #f1f5f9",position:"sticky",top:0,zIndex:20,boxShadow:"0 1px 4px #0000000a"},
  logo:    {width:32,height:32,background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,color:"#fff"},
  filterBar:{display:"flex",gap:8,padding:"10px 14px",background:"#fff",borderBottom:"1px solid #f1f5f9"},
  mInput:  {flex:1,background:"#f8fafc",border:"1.5px solid #e2e8f0",color:"#1e293b",borderRadius:8,padding:"7px 8px",fontSize:13},
  sel:     {flex:1,background:"#f8fafc",border:"1.5px solid #e2e8f0",color:"#1e293b",borderRadius:8,padding:"7px 4px",fontSize:12},
  sumRow:  {display:"flex",gap:10,padding:"14px 14px 10px"},
  sumCard: {flex:1,background:"#fff",borderRadius:14,padding:"12px 10px",textAlign:"center",boxShadow:"0 1px 4px #0000000d"},
  listArea:{padding:"8px 14px",display:"flex",flexDirection:"column",gap:8},
  empty:   {textAlign:"center",color:"#94a3b8",padding:"48px 0",fontSize:14},
  card:    {display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:14,padding:"12px 14px",boxShadow:"0 1px 4px #0000000d",border:"1px solid #f1f5f9"},
  cDate:   {textAlign:"center",minWidth:28,borderRight:"1px solid #f1f5f9",paddingRight:10},
  badge:   {fontSize:10,borderRadius:5,padding:"2px 7px",fontWeight:600,whiteSpace:"nowrap"},
  editBtn: {background:"#eff6ff",border:"none",color:"#2563eb",borderRadius:5,padding:"3px 8px",fontSize:11,cursor:"pointer",fontWeight:600},
  delBtn:  {background:"#fef2f2",border:"none",color:"#dc2626",borderRadius:5,padding:"3px 8px",fontSize:11,cursor:"pointer",fontWeight:600},
  modeBar: {display:"flex",borderBottom:"2px solid #f1f5f9",background:"#fff"},
  modeBtn: {flex:1,padding:"14px 8px",background:"none",border:"none",color:"#94a3b8",fontSize:15,cursor:"pointer",fontWeight:700,borderBottom:"3px solid transparent",marginBottom:-2},
  subBar:  {display:"flex",borderBottom:"1px solid #f1f5f9",padding:"0 16px",gap:4,background:"#fff"},
  subBtn:  {padding:"10px 14px",background:"none",border:"none",color:"#94a3b8",fontSize:13,cursor:"pointer",fontWeight:600,borderBottom:"2px solid transparent"},
  subOn:   {color:"#2563eb",borderBottom:"2px solid #3b82f6"},
  form:    {padding:"16px 20px",display:"flex",flexDirection:"column",gap:14,background:"#f8fafc"},
  ft:      {fontSize:17,fontWeight:800,letterSpacing:-0.5,color:"#1e293b",marginBottom:2},
  inp:     {flex:1,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:9,color:"#1e293b",padding:"9px 12px",fontSize:14,outline:"none"},
  saveBtn: {background:"#2563eb",color:"#fff",border:"none",borderRadius:12,padding:"13px",fontSize:15,fontWeight:700,cursor:"pointer",width:"100%"},
  cancelBtn:{background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:12,padding:"11px",fontSize:14,cursor:"pointer",width:"100%"},
  exBox:   {background:"#f0f9ff",borderRadius:8,padding:"10px 14px",border:"1px dashed #93c5fd"},
  exL:     {fontSize:11,color:"#3b82f6",marginBottom:4,fontWeight:600},
  exP:     {fontSize:12,color:"#64748b",margin:0,lineHeight:1.7},
  ta:      {background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:10,color:"#1e293b",padding:"12px",fontSize:13,minHeight:100,resize:"vertical",outline:"none",lineHeight:1.6},
  preview: {background:"#fff",borderRadius:12,padding:16,display:"flex",flexDirection:"column",gap:12,border:"1.5px solid #93c5fd"},
  nav:     {position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,display:"flex",background:"#fff",borderTop:"1px solid #f1f5f9",zIndex:30,boxShadow:"0 -1px 8px #0000000d"},
  navBtn:  {flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"10px 0 12px",background:"none",border:"none",borderTop:"2px solid transparent",color:"#94a3b8",cursor:"pointer"},
  toast:   {position:"fixed",bottom:84,left:"50%",transform:"translateX(-50%)",background:"#1e293b",color:"#fff",padding:"11px 22px",borderRadius:22,fontSize:14,boxShadow:"0 4px 20px #00000033",zIndex:999,whiteSpace:"nowrap",fontWeight:600},
};

const Sc={
  cbEdit:  {background:"#eff6ff",border:"none",color:"#2563eb",borderRadius:5,padding:"4px 9px",fontSize:11,cursor:"pointer",fontWeight:600},
  cbDel:   {background:"#fef2f2",border:"none",color:"#dc2626",borderRadius:5,padding:"4px 9px",fontSize:11,cursor:"pointer",fontWeight:600},
  cbSave:  {background:"#2563eb",border:"none",color:"#fff",borderRadius:5,padding:"4px 9px",fontSize:11,cursor:"pointer",fontWeight:600},
  cbCancel:{background:"#f1f5f9",border:"none",color:"#64748b",borderRadius:5,padding:"4px 9px",fontSize:11,cursor:"pointer",fontWeight:600},
};
