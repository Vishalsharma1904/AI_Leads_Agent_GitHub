import { Search, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const actions = [
  { id: 'file', label: 'File', hasSub: true },
  { id: 'edit', label: 'Edit', hasSub: true },
  { id: 'view', label: 'View', hasSub: true },
  { divider: true },
  { id: 'plugins', label: 'Plugins', hasSub: true },
  { id: 'preferences', label: 'Preferences', hasSub: true },
  { divider: true },
  { id: 'aibalance', label: 'AI balance', hasSub: true },
  { id: 'help', label: 'Help and account', hasSub: true },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Handle Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-[280px] rounded-xl border border-white/[0.08] bg-[#1e1e1e]/80 backdrop-blur-3xl shadow-2xl overflow-hidden pointer-events-auto"
              style={{
                boxShadow: '0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
              }}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
                <Search className="w-[18px] h-[18px] text-white/50 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Actions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-[13px] font-semibold text-white placeholder:text-white/50"
                />
                <div className="text-[10px] font-bold text-white/40 tracking-wider">Ctrl+K</div>
              </div>

              <div className="py-2 flex flex-col">
                {actions.map((action, idx) => {
                  if (action.divider) {
                    return <div key={idx} className="h-[1px] bg-white/[0.06] my-1" />;
                  }
                  
                  return (
                    <button
                      key={action.id}
                      className="flex items-center justify-between px-4 py-[6px] hover:bg-white/[0.08] transition-colors text-left w-full group"
                    >
                      <span className="text-[13px] font-semibold text-white/90 group-hover:text-white">
                        {action.label}
                      </span>
                      {action.hasSub && (
                        <ChevronRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70" />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
