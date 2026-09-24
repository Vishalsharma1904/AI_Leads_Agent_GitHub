import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

/* ── Helper: get user profile from localStorage ── */
function getUserProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('skylark_user_profile') || '{}');
    return { name: p.name || 'Ajay Sharma', company: p.company || 'eevo.team' };
  } catch {
    return { name: 'Ajay Sharma', company: 'eevo.team' };
  }
}

/* ── SVG icons matching old app ── */
const Icons = {
  Sparkles: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8z"/>
    </svg>
  ),
  MessageSquare: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  PhoneCall: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.38C1.5 3.53 2 2.59 3.07 2.18L6 1h.16A2 2 0 0 1 8 3v.18"/><path d="M16 3c.37 2.2 1.65 4.03 3.5 5"/>
    </svg>
  ),
  Users: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Dashboard: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  ),
  Database: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  Contact: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  UserSearch: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="8" r="4"/><path d="M21 21l-4.35-4.35"/><circle cx="17" cy="17" r="3"/><path d="M2 21v-2a4 4 0 0 1 4-4h4"/>
    </svg>
  ),
  Zap: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Key: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
  ),
  Settings: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Chevron: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  SkylarkStar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L14.7 9.3L22 12L14.7 14.7L12 22L9.3 14.7L2 12L9.3 9.3L12 2Z" fill="#ffffff"/>
    </svg>
  ),
};

export function Sidebar() {
  const location = useLocation();
  const [dataHubOpen, setDataHubOpen] = useState(true);
  const [apifyUsage] = useState(90);
  const profile = getUserProfile();

  /* ── User avatar initial ── */
  const initial = profile.name?.[0]?.toUpperCase() || 'A';

  return (
    <aside style={{
      width: 215,
      minWidth: 215,
      height: '100vh',
      background: '#1c1c1e',
      borderRight: '0.5px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      zIndex: 20,
      flexShrink: 0,
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflow: 'hidden',
    }}>

      {/* Tubelight effect */}
      <div style={{ position:'absolute',top:0,left:0,right:0,bottom:0,pointerEvents:'none',zIndex:1 }}>
        <div style={{
          position:'absolute',top:0,left:'10%',right:'10%',height:2,
          background:'#fff',
          boxShadow:'0 0 5px #fff, 0 0 15px #fff, 0 0 30px rgba(99,102,241,0.8), 0 0 60px rgba(99,102,241,0.4)',
          borderRadius:4,
        }}/>
        <div style={{
          position:'absolute',top:0,left:'-25%',right:'-25%',bottom:0,
          background:'linear-gradient(to bottom, rgba(255,255,255,0.06) 0%, rgba(99,102,241,0.02) 20%, transparent 60%)',
          clipPath:'polygon(20% 0, 80% 0, 100% 100%, 0 100%)',
        }}/>
      </div>

      {/* ── Header ── */}
      <div style={{
        position:'relative',zIndex:10,
        padding:'14px 14px 12px',
        borderBottom:'0.5px solid rgba(255,255,255,0.08)',
        display:'flex',flexDirection:'column',gap:10,
        background:'rgba(0,0,0,0.05)',
        flexShrink:0,
      }}>
        {/* macOS traffic lights */}
        <div style={{ display:'flex',alignItems:'center',gap:7 }}>
          <span style={{ width:13,height:13,borderRadius:'50%',background:'#ff5f56',display:'inline-block',cursor:'pointer' }}/>
          <span style={{ width:13,height:13,borderRadius:'50%',background:'#ffbd2e',display:'inline-block',cursor:'pointer' }}/>
          <span style={{ width:13,height:13,borderRadius:'50%',background:'#27c93f',display:'inline-block',cursor:'pointer' }}/>
        </div>
        {/* Brand row */}
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{
            width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',
            background:'rgba(255,255,255,0.08)',borderRadius:9,border:'1px solid rgba(255,255,255,0.1)',
            flexShrink:0,
          }}>
            <Icons.SkylarkStar />
          </div>
          <div>
            <div style={{ fontSize:13.5,fontWeight:700,color:'#fff',letterSpacing:'-0.3px',lineHeight:1.2 }}>Skylark</div>
            <div style={{ fontSize:11,color:'#64748b',fontWeight:500 }}>eevo.team</div>
          </div>
        </div>
      </div>

      {/* ── Nav scrollable area ── */}
      <div style={{
        flex:1,overflowY:'auto',overflowX:'hidden',padding:'8px 8px',
        position:'relative',zIndex:10,
        scrollbarWidth:'none',
      }}>
        {/* AI ASSISTANT */}
        <SectionLabel>AI ASSISTANT</SectionLabel>

        <NavItem
          path="/jarvis"
          icon={<Icons.Sparkles />}
          active={location.pathname === '/jarvis'}
          badge={<span style={{ fontSize:9,background:'rgba(234,179,8,0.2)',color:'#eab308',padding:'1px 5px',borderRadius:4,marginLeft:4 }}>DEV</span>}
        >
          Jarvis AI
        </NavItem>

        <NavItem
          path="/chat-ai"
          icon={<Icons.MessageSquare />}
          active={location.pathname === '/chat-ai'}
        >
          Client AI (Chat)
        </NavItem>

        <NavItem
          path="/voice-ai"
          icon={<Icons.PhoneCall />}
          active={location.pathname === '/voice-ai'}
        >
          Voice Calling AI
        </NavItem>

        <NavItem
          path="/candidate-ai"
          icon={<Icons.Users />}
          active={location.pathname === '/candidate-ai'}
        >
          Candidate AI
        </NavItem>

        {/* LEAD & DATA HUB */}
        <SectionLabel style={{ marginTop:14 }}>LEAD & DATA HUB</SectionLabel>

        <NavItem
          path="/dashboard"
          icon={<Icons.Dashboard />}
          active={location.pathname === '/dashboard'}
        >
          Dashboard
        </NavItem>

        {/* Data Hub collapsible */}
        <div style={{ margin:'4px 0' }}>
          <button
            onClick={() => setDataHubOpen(o => !o)}
            style={{
              display:'flex',alignItems:'center',gap:10,padding:'8px 10px',
              borderRadius:9,color:'#94a3b8',fontSize:12.5,fontWeight:500,
              textDecoration:'none',width:'100%',border:'1px solid transparent',
              background:'transparent',cursor:'pointer',height:35,
            }}
          >
            <Icons.Database />
            <span style={{ flex:1,textAlign:'left' }}>Data Hub</span>
            <div style={{
              width:12,height:12,color:'#94a3b8',
              transform: dataHubOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition:'transform 0.25s ease',
            }}>
              <Icons.Chevron />
            </div>
          </button>

          {dataHubOpen && (
            <div style={{ display:'flex',flexDirection:'column',gap:2,padding:'4px 0 2px 8px' }}>
              <SubNavItem path="/leads" active={location.pathname === '/leads'}>
                <Icons.Contact />
                All Leads
              </SubNavItem>
              <SubNavItem path="/candidate-db" active={location.pathname === '/candidate-db'}>
                <Icons.UserSearch />
                Candidate DB
              </SubNavItem>
              <SubNavItem path="/excel" active={location.pathname === '/excel'}>
                <span style={{ width:7,height:7,minWidth:7,borderRadius:'50%',background:'#ef4444',boxShadow:'0 0 8px rgba(239,68,68,0.8)',display:'inline-block' }}/>
                Excel Manager
              </SubNavItem>
              <SubNavItem path="/analytics" active={location.pathname === '/analytics'}>
                <span style={{ width:7,height:7,minWidth:7,borderRadius:'50%',background:'#a855f7',boxShadow:'0 0 8px rgba(168,85,247,0.8)',display:'inline-block' }}/>
                Analytics
              </SubNavItem>
            </div>
          )}
        </div>

        {/* SYSTEM */}
        <SectionLabel style={{ marginTop:14 }}>SYSTEM</SectionLabel>

        <NavItem
          path="/tokens"
          icon={<Icons.Key />}
          active={location.pathname === '/tokens'}
        >
          API Keys
        </NavItem>

        <NavItem
          path="/settings"
          icon={<Icons.Settings />}
          active={location.pathname === '/settings'}
        >
          Settings
        </NavItem>
      </div>

      {/* ── Footer ── */}
      <div style={{
        flexShrink:0,padding:'10px 12px',
        borderTop:'1px solid rgba(255,255,255,0.06)',
        display:'flex',flexDirection:'column',gap:8,
        background:'#060608',
        position:'relative',zIndex:10,
      }}>
        {/* Apify status */}
        <div style={{
          display:'flex',alignItems:'center',gap:8,padding:'6px 10px',
          background:'rgba(16,185,129,0.06)',border:'1px solid rgba(16,185,129,0.15)',
          borderRadius:10,cursor:'pointer',
        }}>
          <div style={{ color:'#10b981',display:'flex',alignItems:'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 2l-2 2m-2-2l2 2M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z"/>
            </svg>
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:1 }}>
            <span style={{ fontSize:11,fontWeight:700,color:'#fff' }}>Apify Cloud API</span>
            <span style={{ fontSize:9.5,color:'#10b981',fontWeight:600 }}>Key Active</span>
          </div>
        </div>

        {/* APIFY USAGE bar */}
        <div style={{
          background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',
          borderRadius:10,padding:'8px 10px',display:'flex',flexDirection:'column',gap:6,
        }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <span style={{ fontSize:11,color:'#94a3b8',fontWeight:600 }}>APIFY USAGE</span>
            <span style={{ fontSize:10.5,color:'#a855f7',fontWeight:700 }}>{apifyUsage} / 500</span>
          </div>
          <div style={{ width:'100%',height:4,background:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden' }}>
            <div style={{
              height:'100%',
              background:'linear-gradient(90deg, #a855f7, #ec4899)',
              borderRadius:4,
              width:`${(apifyUsage/500)*100}%`,
            }}/>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ── Sub-components ── */
function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize:9.5,fontWeight:700,textTransform:'uppercase',
      letterSpacing:'0.15em',color:'#475569',
      padding:'8px 8px 4px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function NavItem({ path, icon, active, children, badge }) {
  return (
    <NavLink
      to={path}
      style={{
        display:'flex',alignItems:'center',gap:10,padding:'8px 10px',
        borderRadius:9,fontSize:12.5,fontWeight: active ? 600 : 500,
        textDecoration:'none',marginBottom:2,height:35,
        color: active ? '#ffffff' : '#94a3b8',
        background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
        border: active ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
        boxShadow: active ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      <span style={{ flexShrink:0,display:'flex',alignItems:'center',width:18,height:18,opacity: active ? 1 : 0.65 }}>
        {icon}
      </span>
      <span style={{ flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>
        {children}
      </span>
      {badge}
    </NavLink>
  );
}

function SubNavItem({ path, active, children }) {
  return (
    <NavLink
      to={path}
      style={{
        display:'flex',alignItems:'center',gap:10,padding:'6px 10px',
        fontSize:12.5,fontWeight: active ? 600 : 500,
        color: active ? '#ffffff' : '#94a3b8',
        borderRadius:8,textDecoration:'none',height:32,
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
      }}
    >
      {children}
    </NavLink>
  );
}
