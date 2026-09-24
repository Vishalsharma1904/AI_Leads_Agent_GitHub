import { useLocation } from 'react-router-dom';

const PAGE_LABELS = {
  '/dashboard': 'Dashboard',
  '/chat-ai': 'Client AI',
  '/candidate-ai': 'Candidate AI',
  '/jarvis': 'Jarvis AI',
  '/voice-ai': 'Voice Calling AI',
  '/leads': 'All Leads',
  '/candidate-db': 'Candidate DB',
  '/excel': 'Excel Manager',
  '/analytics': 'Analytics',
  '/tokens': 'API Keys',
  '/settings': 'Settings',
};

export function Topbar({ totalLeads = 0 }) {
  const location = useLocation();
  const pageLabel = PAGE_LABELS[location.pathname] || 'Dashboard';

  return (
    <header style={{
      height: 34,
      background: 'rgba(15,15,17,0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '0.5px solid rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      gap: 10,
      flexShrink: 0,
      zIndex: 50,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* Left: breadcrumb */}
      <div style={{ display:'flex',alignItems:'center',gap:8 }}>
        <span style={{ fontSize:13.5,fontWeight:700,color:'rgba(255,255,255,0.92)' }}>
          {pageLabel}
        </span>
      </div>

      {/* Right: chip + run agent */}
      <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
        <div style={{
          display:'flex',alignItems:'center',gap:4,
          fontSize:10,fontWeight:600,color:'#f1f5f9',
          background:'rgba(255,255,255,0.04)',
          padding:'3px 8px',borderRadius:6,whiteSpace:'nowrap',
          border:'1px solid rgba(255,255,255,0.05)',
          boxShadow:'0 2px 5px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
          height:22,
        }}>
          {totalLeads} leads
        </div>

        <button style={{
          display:'inline-flex',alignItems:'center',gap:4,
          padding:'3px 8px',
          background:'rgba(255,255,255,0.04)',
          color:'#f1f5f9',borderRadius:6,fontSize:10,fontWeight:600,
          boxShadow:'0 2px 5px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
          whiteSpace:'nowrap',
          border:'1px solid rgba(255,255,255,0.05)',
          height:22,cursor:'pointer',
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Run Agent
        </button>
      </div>
    </header>
  );
}
