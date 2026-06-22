import React, { useState, useEffect, useMemo } from 'react';

// Definição de Tipos
interface Asset {
    id: string;
    name: string;
    path: string;
    size: number;
    transferSize: number;
    decodedSize: number;
    duration: number;
    category: string;
    protocol: string;
    initiator: string;
    startTime: number;
    isHeavy: boolean;
    isCached: boolean;
    savedByCompression: number;
}

interface TabConfig {
    id: string;
    label: string;
    special?: boolean;
}

// Constantes
const HEAVY_THRESHOLD = 500; // KB
const SLOW_THRESHOLD = 1000; // ms

const TABS: TabConfig[] = [
    { id: 'all', label: 'All Resources' },
    { id: 'script', label: 'JS/Modules' },
    { id: 'style', label: 'CSS/Styles' },
    { id: 'image', label: 'Images' },
    { id: 'api', label: 'API/Fetch' },
    { id: 'heavy', label: '⚠️ Heavy Only', special: true },
    { id: 'uncached', label: '❌ Missed Cache' }
];

// Funções Auxiliares
const getCategory = (res: PerformanceResourceTiming): string => {
    const name = res.name.toLowerCase();
    const type = res.initiatorType;

    if (type === 'script' || name.endsWith('.js') || name.endsWith('.mjs')) return 'script';
    if (type === 'img' || type === 'image' || /\.(png|jpe?g|gif|svg|webp|avif|ico)$/.test(name)) return 'image';
    if (type === 'css' || type === 'link' || name.endsWith('.css')) return 'style';
    if (type === 'font' || /\.(woff2?|ttf|otf|eot)$/.test(name)) return 'font';
    if (type === 'fetch' || type === 'xmlhttprequest') return 'api';
    return 'other';
};

const getCategoryIcon = (category: string): string => {
    switch (category) {
        case 'script':
            return 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2 13 9 20 9';
        case 'image':
            return 'M3 3h18v18H3z M8.5 8.5m1.5 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0z M21 15l-5-5-11 11';
        case 'style':
            return 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 12m3 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
        case 'api':
            return 'M13 2l-10 12h9l-1 8 10-12h-9l1-8';
        default:
            return 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z';
    }
};

const getCategoryIconColor = (category: string): string => {
    switch (category) {
        case 'script': return 'text-yellow-500';
        case 'image': return 'text-pink-500';
        case 'style': return 'text-blue-500';
        case 'api': return 'text-green-500';
        default: return 'text-gray-400';
    }
};

export default function DevToolsAnalyzer() {
    // Estado
    const [assets, setAssets] = useState<Asset[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    // Lifecycle
    useEffect(() => {
        const scanAssets = () => {
            if (typeof performance === 'undefined') return;

            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

            const mappedAssets = resources
                .map((res) => {
                    const name = res.name.split('/').pop() || res.name;
                    const transferSizeKB = res.transferSize / 1024;
                    const decodedSizeKB = res.decodedBodySize / 1024;
                    const encodedSizeKB = res.encodedBodySize / 1024;
                    const category = getCategory(res);

                    const isCached = res.transferSize === 0 && res.decodedBodySize > 0;
                    const size = transferSizeKB > 0 ? transferSizeKB : decodedSizeKB;
                    const savedByCompression = decodedSizeKB > encodedSizeKB ? decodedSizeKB - encodedSizeKB : 0;

                    return {
                        id: `${res.name}-${res.startTime}`,
                        name: name || 'Resource',
                        path: res.name,
                        size: size || 0,
                        transferSize: transferSizeKB,
                        decodedSize: decodedSizeKB,
                        duration: res.duration,
                        category,
                        protocol: res.nextHopProtocol || 'h2',
                        initiator: res.initiatorType,
                        startTime: res.startTime,
                        isHeavy: size > HEAVY_THRESHOLD,
                        isCached,
                        savedByCompression
                    };
                })
                .sort((a, b) => b.size - a.size);

            setAssets(mappedAssets);
        };

        scanAssets();

        let observerRef: PerformanceObserver | null = null;
        if (typeof PerformanceObserver !== 'undefined') {
            observerRef = new PerformanceObserver(() => scanAssets());
            observerRef.observe({ entryTypes: ['resource'] });
        }

        return () => {
            if (observerRef) {
                observerRef.disconnect();
            }
        };
    }, []);

    // Computed Properties
    const stats = useMemo(() => {
        const totalSize = assets.reduce((acc, curr) => acc + curr.size, 0);
        const totalDecodedSize = assets.reduce((acc, curr) => acc + curr.decodedSize, 0);
        const totalSavedByCompression = assets.reduce((acc, curr) => acc + curr.savedByCompression, 0);
        const avgLoadTime = assets.length
            ? assets.reduce((acc, curr) => acc + curr.duration, 0) / assets.length
            : 0;
        const heavyFiles = assets.filter((a) => a.isHeavy).length;
        const cacheHits = assets.filter((a) => a.isCached).length;
        const slowestAssetTime = assets.length ? Math.max(...assets.map((a) => a.duration)) : 0;

        return {
            totalSize,
            totalDecodedSize,
            avgLoadTime,
            totalRequests: assets.length,
            images: assets.filter((a) => a.category === 'image').length,
            scripts: assets.filter((a) => a.category === 'script').length,
            heavyFiles,
            cacheHits,
            cacheHitRate: assets.length ? (cacheHits / assets.length) * 100 : 0,
            slowestAssetTime,
            totalSavedByCompression
        };
    }, [assets]);

    const filteredAssets = useMemo(() => {
        return assets.filter((asset) => {
            const matchesSearch =
                asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                asset.path.toLowerCase().includes(searchTerm.toLowerCase());

            if (activeFilter === 'heavy') return matchesSearch && asset.isHeavy;
            if (activeFilter === 'uncached') return matchesSearch && !asset.isCached;

            const matchesFilter = activeFilter === 'all' || asset.category === activeFilter;
            return matchesSearch && matchesFilter;
        });
    }, [assets, searchTerm, activeFilter]);

    const topSlowestAssets = useMemo(() => {
        return [...assets]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 3);
    }, [assets]);

    // Handlers
    const handleRefresh = () => {
        window.location.reload();
    };

    const handleDownloadLog = () => {
        const logData = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            summary: stats,
            slowestResources: topSlowestAssets,
            allResources: assets
        };

        const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `perf-analyzer-log-${new Date().getTime()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="min-h-screen bg-black text-[#ededed] font-sans selection:bg-white/20">
            {/* CSS Global Inject */}
            <style dangerouslySetInnerHTML={{ __html: `
                .grid-bg {
                    background-image:
                        linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
                    background-size: 60px 60px;
                    mask-image: radial-gradient(circle at center, black, transparent 90%);
                    -webkit-mask-image: radial-gradient(circle at center, black, transparent 90%);
                }
                .custom-scrollbar-hide {
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }
                .custom-scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
            `}} />

            {/* Navbar */}
            <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between bg-black/50 backdrop-blur-md sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[8px] border-b-black mb-0.5"></div>
                        </div>
                        <span className="text-white font-medium text-sm">DevTools Pro Analyzer</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleDownloadLog}
                        className="flex items-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        EXPORT LOG .JSON
                    </button>
                    {stats.heavyFiles > 0 && (
                        <div className="flex items-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 gap-2 animate-pulse">
                            <span className="text-[10px] text-red-500 font-bold uppercase">{stats.heavyFiles} Heavy Assets!</span>
                        </div>
                    )}
                </div>
            </nav>

            {/* Tabs */}
            <div className="border-b border-white/10 px-6 overflow-x-auto bg-black/30 custom-scrollbar-hide">
                <div className="flex gap-6 text-sm text-gray-400 pt-3">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={`pb-3 border-b transition-all whitespace-nowrap ${
                                activeFilter === tab.id
                                    ? tab.special
                                        ? 'text-red-500 border-red-500'
                                        : 'text-white border-white'
                                    : tab.special
                                        ? 'border-transparent hover:text-red-400'
                                        : 'border-transparent hover:text-white'
                            } ${tab.special ? 'font-bold' : ''}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <main className="p-6 max-w-[1400px] mx-auto space-y-8 relative z-10">
                {/* Search and Refresh */}
                <div className="flex justify-between items-center gap-4">
                    <div className="relative w-full max-w-xl">
                        <input
                            type="text"
                            placeholder="Search resources (name, path, initiator...)"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-white/30 transition-all"
                        />
                        <svg className="absolute left-3 top-2.5 text-gray-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <button
                        onClick={handleRefresh}
                        className="bg-white text-black cursor-pointer px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors shrink-0"
                    >
                        Refresh Scan
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Assets List (Left - 3 Columns) */}
                    <div className="lg:col-span-3 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
                                Live Assets ({filteredAssets.length})
                            </h2>
                        </div>

                        <div className="space-y-3">
                            {filteredAssets.map((asset) => (
                                <div
                                    key={asset.id}
                                    className={`group bg-white/[0.02] border rounded-xl p-4 hover:border-white/20 transition-all cursor-pointer relative overflow-hidden ${
                                        asset.isHeavy ? 'border-red-500/40 bg-red-500/[0.02]' : 'border-white/10'
                                    }`}
                                >
                                    {/* Tags Superiores */}
                                    <div className="absolute top-0 right-0 flex">
                                        {asset.isCached && (
                                            <div className="px-3 py-1 bg-green-500/20 text-green-400 border-b border-l border-green-500/20 text-[9px] font-black uppercase tracking-tighter">
                                                Cached
                                            </div>
                                        )}
                                        {asset.isHeavy && (
                                            <div className="px-3 py-1 bg-red-500 text-white text-[9px] font-black uppercase tracking-tighter">
                                                Heavy Resource
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-start justify-between mt-2">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center border border-white/5 shrink-0">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={getCategoryIconColor(asset.category)}>
                                                    <path d={getCategoryIcon(asset.category)} />
                                                </svg>
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-medium text-[14px] group-hover:underline truncate">{asset.name}</h3>
                                                <p className="text-xs text-gray-500 font-mono truncate max-w-lg">{asset.path}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1.5 shrink-0 mr-12">
                                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 font-bold uppercase text-gray-400">
                                                {asset.initiator}
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-mono">{asset.protocol}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-400">
                                        <div className={`flex items-center gap-1.5 ${asset.isHeavy ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                                            <div className={`w-2 h-2 rounded-full ${asset.isHeavy ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`}></div>
                                            {asset.size.toFixed(1)} KB
                                        </div>
                                        <div className={`flex items-center gap-1.5 ${asset.duration > SLOW_THRESHOLD ? 'text-yellow-500' : ''}`}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <polyline points="12 6 12 12 16 14"></polyline>
                                            </svg>
                                            {asset.duration.toFixed(0)}ms
                                        </div>
                                        {asset.savedByCompression > 0 && (
                                            <div className="flex items-center gap-1.5 text-green-400/80">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                    <polyline points="17 8 12 3 7 8"></polyline>
                                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                                </svg>
                                                Saved {asset.savedByCompression.toFixed(1)} KB
                                            </div>
                                        )}
                                        <div className="text-[10px] text-gray-600 uppercase font-bold tracking-tighter">
                                            Start: {asset.startTime.toFixed(0)}ms
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {filteredAssets.length === 0 && (
                                <div className="text-center py-12 border border-dashed border-white/10 rounded-xl text-gray-500">
                                    Nenhum recurso encontrado com estes filtros.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Dashboards and Stats (Right - 1 Column) */}
                    <div className="space-y-6">
                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Dashboards & Metrics</h2>

                        {/* Main Core Web Vitals / Loading Panel */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5 space-y-6">
                            {/* Network Transfer vs Actual Decoded Size */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-400">Total Network Transfer</span>
                                    <span className="text-white font-mono">{(stats.totalSize / 1024).toFixed(2)} MB</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-500">Uncompressed Size</span>
                                    <span className="text-gray-400 font-mono">{(stats.totalDecodedSize / 1024).toFixed(2)} MB</span>
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mt-1 relative">
                                    <div className="absolute top-0 left-0 h-full bg-white/30" style={{ width: `${Math.min((stats.totalDecodedSize / 10000) * 100, 100)}%` }}></div>
                                    <div className="absolute top-0 left-0 h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min((stats.totalSize / 10000) * 100, 100)}%` }}></div>
                                </div>
                            </div>

                            {/* Cache Hit Rate */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-400">Cache Hit Rate</span>
                                    <span className="text-green-400 font-mono">{stats.cacheHitRate.toFixed(1)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${stats.cacheHitRate}%` }}></div>
                                </div>
                                <p className="text-[10px] text-gray-500 text-right">{stats.cacheHits} / {stats.totalRequests} cached</p>
                            </div>

                            {/* Avg. Response Time */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-400">Avg. Response Time</span>
                                    <span className="text-white font-mono">{stats.avgLoadTime.toFixed(0)}ms</span>
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className={`h-full transition-all duration-500 ${stats.avgLoadTime > 500 ? 'bg-yellow-500' : 'bg-blue-400'}`} style={{ width: `${Math.min((stats.avgLoadTime / 1000) * 100, 100)}%` }}></div>
                                </div>
                            </div>

                            {/* Rapid Stats Grid */}
                            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/5">
                                <div className="bg-white/5 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Requests</div>
                                    <div className="text-lg font-bold text-white">{stats.totalRequests}</div>
                                </div>
                                <div className="bg-white/5 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Images</div>
                                    <div className="text-lg font-bold text-pink-400">{stats.images}</div>
                                </div>
                                <div className="bg-white/5 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Scripts</div>
                                    <div className="text-lg font-bold text-yellow-400">{stats.scripts}</div>
                                </div>
                                <div className="bg-white/5 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Bandwidth Saved</div>
                                    <div className="text-sm font-bold text-green-400 mt-1">{(stats.totalSavedByCompression / 1024).toFixed(1)}MB</div>
                                </div>
                            </div>
                        </div>

                        {/* Top 3 Slowest Panel */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-5 space-y-4">
                            <h3 className="text-xs font-bold text-gray-300 uppercase flex items-center gap-2">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                Top 3 Slowest Assets
                            </h3>
                            <div className="space-y-3">
                                {topSlowestAssets.map((asset, i) => (
                                    <div key={i} className="flex flex-col gap-1">
                                        <div className="flex justify-between text-[11px]">
                                            <span className="text-gray-400 truncate pr-2" title={asset.name}>{asset.name}</span>
                                            <span className="text-yellow-500 font-mono shrink-0">{asset.duration.toFixed(0)}ms</span>
                                        </div>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-yellow-500/50" style={{ width: `${(asset.duration / stats.slowestAssetTime) * 100}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                                {topSlowestAssets.length === 0 && (
                                    <p className="text-xs text-gray-600">Nenhum dado capturado ainda.</p>
                                )}
                            </div>
                        </div>

                        {/* Alert or Success */}
                        {stats.heavyFiles > 0 ? (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 border-l-4 border-l-red-500">
                                <h4 className="text-sm font-bold text-red-500 mb-1 flex items-center gap-2">
                                    ⚠️ Performance Alert
                                </h4>
                                <p className="text-xs text-gray-400 mb-4">
                                    Você tem {stats.heavyFiles} arquivos pesando muito na carga da página (&gt;500KB).
                                </p>
                                <button
                                    onClick={() => setActiveFilter('heavy')}
                                    className="text-xs text-white underline decoration-white/30 hover:decoration-white transition-all"
                                >
                                    Filtrar arquivos pesados
                                </button>
                            </div>
                        ) : (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 border-l-4 border-l-green-500">
                                <h4 className="text-sm font-bold text-green-500 mb-1 flex items-center gap-2">
                                    ✅ System Optimized
                                </h4>
                                <p className="text-xs text-gray-400">Nenhum recurso crítico detectado passando dos limites de segurança.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Grid Background */}
            <div className="fixed inset-0 pointer-events-none grid-bg z-0"></div>
        </div>
    );
}