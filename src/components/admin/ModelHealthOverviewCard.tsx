import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { 
  RefreshCw, 
  CheckCircle,
  AlertTriangle,
  XCircle,
  Activity,
  Zap,
  TrendingUp,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// All Gemini models tracked in the system
const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', displayName: '2.0 Flash', description: 'Speaking evaluation primary' },
  { id: 'gemini-2.0-flash-lite', displayName: '2.0 Flash Lite', description: 'Answer explanations' },
  { id: 'gemini-2.0-flash-lite-preview-02-05', displayName: '2.0 Flash Lite Preview', description: 'Backup audio' },
  { id: 'gemini-2.5-flash', displayName: '2.5 Flash', description: 'Evaluation backup' },
  { id: 'gemini-2.5-flash-preview-tts', displayName: '2.5 Flash TTS', description: 'Audio generation' },
  { id: 'gemini-2.5-pro', displayName: '2.5 Pro', description: 'Writing evaluation' },
  { id: 'gemini-3-pro-preview', displayName: '3 Pro', description: 'Writing primary' },
];

interface ModelHealthData {
  model_name: string;
  total_calls: number;
  success_count: number;
  error_count: number;
  quota_exceeded_count: number;
  success_rate: number | null;
  avg_response_time_ms: number | null;
}

interface ApiKeyWithQuotas {
  id: string;
  is_active: boolean;
  [key: string]: any;
}

type HealthStatus = 'excellent' | 'good' | 'warning' | 'critical' | 'exhausted' | 'unknown';

interface ModelHealthSummary {
  model: typeof GEMINI_MODELS[number];
  healthStatus: HealthStatus;
  successRate: number | null;
  totalCallsToday: number;
  errorsToday: number;
  quotaHitsToday: number;
  avgResponseTime: number | null;
  isExhausted: boolean;
  exhaustedKeyCount: number;
  availableKeyCount: number;
}

function getHealthStatus(
  successRate: number | null, 
  quotaHits: number,
  totalCalls: number,
  isExhausted: boolean
): HealthStatus {
  if (isExhausted) return 'exhausted';
  if (totalCalls === 0) return 'unknown';
  
  if (successRate === null) return 'unknown';
  
  if (quotaHits > 0) return 'warning';
  if (successRate >= 95) return 'excellent';
  if (successRate >= 85) return 'good';
  if (successRate >= 70) return 'warning';
  return 'critical';
}

function getHealthColor(status: HealthStatus): string {
  switch (status) {
    case 'excellent': return 'text-green-600 bg-green-50 border-green-200';
    case 'good': return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'warning': return 'text-amber-600 bg-amber-50 border-amber-200';
    case 'critical': return 'text-red-600 bg-red-50 border-red-200';
    case 'exhausted': return 'text-purple-600 bg-purple-50 border-purple-200';
    case 'unknown': return 'text-muted-foreground bg-muted/50 border-border';
  }
}

function getHealthIcon(status: HealthStatus) {
  switch (status) {
    case 'excellent': return <TrendingUp className="w-4 h-4" />;
    case 'good': return <CheckCircle className="w-4 h-4" />;
    case 'warning': return <AlertTriangle className="w-4 h-4" />;
    case 'critical': return <XCircle className="w-4 h-4" />;
    case 'exhausted': return <Zap className="w-4 h-4" />;
    case 'unknown': return <Activity className="w-4 h-4" />;
  }
}

function getHealthLabel(status: HealthStatus): string {
  switch (status) {
    case 'excellent': return 'Excellent';
    case 'good': return 'Good';
    case 'warning': return 'Warning';
    case 'critical': return 'Critical';
    case 'exhausted': return 'Exhausted';
    case 'unknown': return 'No Data';
  }
}

// Map model name to database column prefix
const MODEL_TO_DB_COLUMN: Record<string, string> = {
  'gemini-2.0-flash': 'gemini_2_0_flash',
  'gemini-2.0-flash-lite': 'gemini_2_0_flash_lite',
  'gemini-2.0-flash-lite-preview-02-05': 'gemini_2_0_flash_lite',
  'gemini-2.5-flash': 'gemini_2_5_flash',
  'gemini-2.5-flash-preview-tts': 'gemini_2_5_flash_tts',
  'gemini-2.5-pro': 'gemini_2_5_pro',
  'gemini-3-pro-preview': 'gemini_3_pro',
};

export default function ModelHealthOverviewCard() {
  const [modelHealth, setModelHealth] = useState<ModelHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch performance stats for last 24 hours
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_model_performance_stats', { p_hours: 24 });

      if (statsError) throw statsError;

      // Fetch API keys to check exhaustion status
      const { data: apiKeysData, error: apiKeysError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('provider', 'gemini');

      if (apiKeysError) throw apiKeysError;

      const today = new Date().toISOString().split('T')[0];
      const performanceByModel = new Map<string, ModelHealthData>();

      // Aggregate stats by model
      (statsData || []).forEach((stat: ModelHealthData) => {
        const existing = performanceByModel.get(stat.model_name);
        if (existing) {
          existing.total_calls += stat.total_calls;
          existing.success_count += stat.success_count;
          existing.error_count += stat.error_count;
          existing.quota_exceeded_count += stat.quota_exceeded_count;
          // Recalculate success rate
          existing.success_rate = existing.total_calls > 0 
            ? Math.round((existing.success_count / existing.total_calls) * 100) 
            : null;
          // Average response time (simple average for now)
          if (stat.avg_response_time_ms && existing.avg_response_time_ms) {
            existing.avg_response_time_ms = (existing.avg_response_time_ms + stat.avg_response_time_ms) / 2;
          } else if (stat.avg_response_time_ms) {
            existing.avg_response_time_ms = stat.avg_response_time_ms;
          }
        } else {
          performanceByModel.set(stat.model_name, { ...stat });
        }
      });

      // Build health summaries for each model
      const healthSummaries: ModelHealthSummary[] = GEMINI_MODELS.map(model => {
        const perf = performanceByModel.get(model.id);
        const columnPrefix = MODEL_TO_DB_COLUMN[model.id];
        
        // Count exhausted and available keys for this model
        const activeKeys = (apiKeysData || []).filter((k: ApiKeyWithQuotas) => k.is_active);
        const exhaustedKeys = activeKeys.filter((k: ApiKeyWithQuotas) => {
          const isExhausted = k[`${columnPrefix}_exhausted`] as boolean | null;
          const exhaustedDate = k[`${columnPrefix}_exhausted_date`] as string | null;
          return isExhausted === true && exhaustedDate === today;
        });

        const isExhausted = exhaustedKeys.length >= activeKeys.length && activeKeys.length > 0;

        const healthStatus = getHealthStatus(
          perf?.success_rate ?? null,
          perf?.quota_exceeded_count ?? 0,
          perf?.total_calls ?? 0,
          isExhausted
        );

        return {
          model,
          healthStatus,
          successRate: perf?.success_rate ?? null,
          totalCallsToday: perf?.total_calls ?? 0,
          errorsToday: perf?.error_count ?? 0,
          quotaHitsToday: perf?.quota_exceeded_count ?? 0,
          avgResponseTime: perf?.avg_response_time_ms ?? null,
          isExhausted,
          exhaustedKeyCount: exhaustedKeys.length,
          availableKeyCount: activeKeys.length - exhaustedKeys.length,
        };
      });

      // Sort: exhausted first, then by health status severity, then by call volume
      healthSummaries.sort((a, b) => {
        const statusOrder: Record<HealthStatus, number> = {
          exhausted: 0, critical: 1, warning: 2, good: 3, excellent: 4, unknown: 5
        };
        if (statusOrder[a.healthStatus] !== statusOrder[b.healthStatus]) {
          return statusOrder[a.healthStatus] - statusOrder[b.healthStatus];
        }
        return b.totalCallsToday - a.totalCallsToday;
      });

      setModelHealth(healthSummaries);
    } catch (error) {
      console.error('Error fetching model health data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load model health data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Calculate summary stats
  const healthyModels = modelHealth.filter(m => 
    m.healthStatus === 'excellent' || m.healthStatus === 'good'
  ).length;
  const warningModels = modelHealth.filter(m => m.healthStatus === 'warning').length;
  const criticalModels = modelHealth.filter(m => 
    m.healthStatus === 'critical' || m.healthStatus === 'exhausted'
  ).length;
  const totalCallsToday = modelHealth.reduce((sum, m) => sum + m.totalCallsToday, 0);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-primary" />
            <div>
              <CardTitle>Model Health Overview</CardTitle>
              <CardDescription>
                Real-time health status based on error rates and quota usage (last 24h)
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 text-xs">
              {healthyModels > 0 && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  {healthyModels} healthy
                </Badge>
              )}
              {warningModels > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-600">
                  {warningModels} warning
                </Badge>
              )}
              {criticalModels > 0 && (
                <Badge variant="outline" className="text-red-600 border-red-600">
                  {criticalModels} critical
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={refreshData} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary Row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">{totalCallsToday.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Calls Today</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{healthyModels}</div>
            <div className="text-xs text-green-600">Healthy Models</div>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-2xl font-bold text-amber-600">{warningModels}</div>
            <div className="text-xs text-amber-600">Warning</div>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{criticalModels}</div>
            <div className="text-xs text-red-600">Critical/Exhausted</div>
          </div>
        </div>

        {/* Model Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {modelHealth.map((health) => (
            <Tooltip key={health.model.id}>
              <TooltipTrigger asChild>
                <div 
                  className={`p-3 rounded-lg border cursor-help transition-colors ${getHealthColor(health.healthStatus)}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm truncate">{health.model.displayName}</span>
                    <div className="flex items-center gap-1">
                      {getHealthIcon(health.healthStatus)}
                    </div>
                  </div>
                  
                  {/* Stats Row */}
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="opacity-70">Calls: {health.totalCallsToday}</span>
                    {health.successRate !== null && (
                      <span className="font-medium">{health.successRate}%</span>
                    )}
                  </div>
                  
                  {/* Progress Bar for Success Rate */}
                  {health.totalCallsToday > 0 && (
                    <Progress 
                      value={health.successRate ?? 0} 
                      className="h-1.5"
                    />
                  )}
                  
                  {/* Key Availability */}
                  {health.isExhausted ? (
                    <div className="mt-2 text-xs font-medium">
                      All keys exhausted
                    </div>
                  ) : health.exhaustedKeyCount > 0 ? (
                    <div className="mt-2 text-xs">
                      {health.availableKeyCount}/{health.availableKeyCount + health.exhaustedKeyCount} keys available
                    </div>
                  ) : null}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-2">
                  <div className="font-medium">{health.model.id}</div>
                  <div className="text-xs text-muted-foreground">{health.model.description}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t">
                    <div>
                      <span className="text-muted-foreground">Status:</span>{' '}
                      <span className="font-medium">{getHealthLabel(health.healthStatus)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Calls:</span>{' '}
                      <span className="font-medium">{health.totalCallsToday}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Errors:</span>{' '}
                      <span className="font-medium text-red-600">{health.errorsToday}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Quota Hits:</span>{' '}
                      <span className="font-medium text-amber-600">{health.quotaHitsToday}</span>
                    </div>
                    {health.avgResponseTime && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Avg Response:</span>{' '}
                        <span className="font-medium">{Math.round(health.avgResponseTime)}ms</span>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Keys Available:</span>{' '}
                      <span className="font-medium">
                        {health.availableKeyCount}/{health.availableKeyCount + health.exhaustedKeyCount}
                      </span>
                    </div>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-green-600" />
            <span>Excellent (≥95%)</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-blue-600" />
            <span>Good (≥85%)</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>Warning (&lt;85% or quota hit)</span>
          </div>
          <div className="flex items-center gap-1">
            <XCircle className="w-3 h-3 text-red-600" />
            <span>Critical (&lt;70%)</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-purple-600" />
            <span>Exhausted (all keys)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
