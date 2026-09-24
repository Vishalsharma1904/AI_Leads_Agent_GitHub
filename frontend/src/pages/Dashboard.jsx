import { Users, UserPlus, Shield, Sparkles, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const stats = [
  {
    title: 'Total Leads',
    value: '12,450',
    trend: '+12%',
    isPositive: true,
    desc: 'All buyer companies',
    icon: Users,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
    shadow: 'shadow-[0_0_15px_rgba(99,102,241,0.2)]'
  },
  {
    title: 'New (Uncontacted)',
    value: '3,842',
    trend: '+5.2%',
    isPositive: true,
    desc: 'Ready to call',
    icon: UserPlus,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    shadow: 'shadow-[0_0_15px_rgba(52,211,153,0.2)]'
  },
  {
    title: 'Security Leads',
    value: '8,290',
    trend: '-1.4%',
    isPositive: false,
    desc: 'Needs guards',
    icon: Shield,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    shadow: 'shadow-[0_0_15px_rgba(244,63,94,0.2)]'
  },
  {
    title: 'Housekeeping Leads',
    value: '4,160',
    trend: '+8.1%',
    isPositive: true,
    desc: 'Needs HK staff',
    icon: Sparkles,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    shadow: 'shadow-[0_0_15px_rgba(251,191,36,0.2)]'
  },
];

export function Dashboard() {
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
      
      {/* Header section */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Lead Intelligence</h2>
          <p className="text-sm text-slate-400">Buyer lead intelligence for Skylark Security & Housekeeping</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div key={idx} className="glass rounded-2xl p-5 hover:bg-white/[0.02] transition-colors relative overflow-hidden group">
              {/* Subtle background glow effect */}
              <div className={`absolute -right-8 -top-8 w-24 h-24 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${stat.bg.replace('/10', '')}`} />
              
              <div className="flex items-start justify-between">
                <div className={`p-2.5 rounded-xl ${stat.bg} ${stat.color} ${stat.shadow}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                  stat.isPositive ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                }`}>
                  {stat.trend}
                  {stat.isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                </div>
              </div>
              
              <div className="mt-4">
                <h3 className="text-3xl font-bold text-white tracking-tight">{stat.value}</h3>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-sm font-medium text-slate-300">{stat.title}</p>
                </div>
                <p className="text-xs text-slate-500 mt-1">{stat.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column - Large Chart placeholder */}
        <div className="lg:col-span-2 glass rounded-2xl p-6 flex flex-col min-h-[400px]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white">Lead Acquisition Trends</h3>
            <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none">
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>This Year</option>
            </select>
          </div>
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-white/5 rounded-xl bg-white/[0.01]">
            <p className="text-slate-500 text-sm">Chart Component Placeholder</p>
          </div>
        </div>

        {/* Right Column - Recent Activity */}
        <div className="glass rounded-2xl p-6 flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-6">Recent Activity</h3>
          
          <div className="flex-1 flex flex-col gap-4">
            {[1,2,3,4,5].map((item) => (
              <div key={item} className="flex items-start gap-4">
                <div className="mt-1 h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)] shrink-0" />
                <div>
                  <p className="text-sm text-slate-200">New lead captured: <span className="font-semibold text-white">Apex Tech Park</span></p>
                  <p className="text-xs text-slate-500 mt-0.5">2 mins ago • Security Guards</p>
                </div>
              </div>
            ))}
          </div>
          
          <button className="mt-4 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors">
            View All Activity
          </button>
        </div>

      </div>
    </div>
  );
}
