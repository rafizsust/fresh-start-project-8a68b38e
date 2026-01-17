import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { 
  RefreshCw, 
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Per-model quota tracking - actual Gemini model names
interface ModelConfig {
  id: string;           // Database column prefix
  displayName: string;  // Display name in UI
  description: string;  // What this model is used for
  apiName: string;      // Actual API model name
}

// All models tracked in the system
const GEMINI_MODELS: ModelConfig[] = [
  {
    id: 'gemini_2_0_flash',
    displayName: '2.0 Flash',
    description: 'Speaking evaluation primary',
    apiName: 'gemini-2.0-flash',
  },
  {
    id: 'gemini_2_0_flash_lite',
    displayName: '2.0 Flash Lite',
    description: 'Answer explanations, fast tasks',
    apiName: 'gemini-2.0-flash-lite',
  },
  {
    id: 'gemini_2_5_flash',
    displayName: '2.5 Flash',
    description: 'Speaking/writing evaluation backup',
    apiName: 'gemini-2.5-flash',
  },
  {
    id: 'gemini_2_5_flash_tts',
    displayName: '2.5 Flash TTS',
    description: 'Text-to-speech audio generation',
    apiName: 'gemini-2.5-flash-preview-tts',
  },
  {
    id: 'gemini_2_5_pro',
    displayName: '2.5 Pro',
    description: 'Writing evaluation backup',
    apiName: 'gemini-2.5-pro',
  },
  {
    id: 'gemini_3_pro',
    displayName: '3 Pro',
    description: 'Writing evaluation primary',
    apiName: 'gemini-3-pro-preview',
  },
];

interface ApiKeyWithQuotas {
  id: string;
  key_value: string;
  is_active: boolean;
  created_at: string;
  // Per-model quota fields (dynamic)
  [key: string]: any;
}

export default function ApiKeyQuotaDashboard() {
  const [apiKeys, setApiKeys] = useState<ApiKeyWithQuotas[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('provider', 'gemini')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApiKeys(data || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
      toast({
        title: 'Error',
        description: 'Failed to load API keys',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    await fetchApiKeys();
    setRefreshing(false);
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return key.substring(0, 4) + '••••' + key.substring(key.length - 4);
  };

  const isQuotaExhaustedToday = (date: string | null) => {
    if (!date) return false;
    const today = new Date().toISOString().split('T')[0];
    return date === today;
  };

  const getModelQuotaStatus = (key: ApiKeyWithQuotas, modelId: string) => {
    const exhaustedField = `${modelId}_exhausted`;
    const dateField = `${modelId}_exhausted_date`;
    
    const isExhausted = key[exhaustedField] as boolean | null;
    const exhaustedDate = key[dateField] as string | null;
    
    return isExhausted && isQuotaExhaustedToday(exhaustedDate);
  };

  const toggleModelQuota = async (keyId: string, modelId: string, currentlyExhausted: boolean) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const updateData: Record<string, unknown> = {
        [`${modelId}_exhausted`]: !currentlyExhausted,
        [`${modelId}_exhausted_date`]: !currentlyExhausted ? today : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('api_keys')
        .update(updateData)
        .eq('id', keyId);

      if (error) throw error;

      setApiKeys(prev =>
        prev.map(key =>
          key.id === keyId
            ? {
                ...key,
                [`${modelId}_exhausted`]: !currentlyExhausted,
                [`${modelId}_exhausted_date`]: !currentlyExhausted ? today : null,
              }
            : key
        )
      );

      const modelConfig = GEMINI_MODELS.find(m => m.id === modelId);
      toast({
        title: 'Success',
        description: `${modelConfig?.displayName || modelId} ${!currentlyExhausted ? 'marked exhausted' : 'quota reset'} for this key`,
      });
    } catch (error) {
      console.error('Error toggling quota:', error);
      toast({
        title: 'Error',
        description: 'Failed to update quota status',
        variant: 'destructive',
      });
    }
  };

  const resetAllQuotasForModel = async (modelId: string) => {
    try {
      const updateData: Record<string, unknown> = {
        [`${modelId}_exhausted`]: false,
        [`${modelId}_exhausted_date`]: null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('api_keys')
        .update(updateData)
        .eq('provider', 'gemini');

      if (error) throw error;

      setApiKeys(prev =>
        prev.map(key => ({
          ...key,
          [`${modelId}_exhausted`]: false,
          [`${modelId}_exhausted_date`]: null,
        }))
      );

      const modelConfig = GEMINI_MODELS.find(m => m.id === modelId);
      toast({
        title: 'Success',
        description: `All ${modelConfig?.displayName || modelId} quotas reset`,
      });
    } catch (error) {
      console.error('Error resetting quotas:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset quotas',
        variant: 'destructive',
      });
    }
  };

  const resetAllQuotas = async () => {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      
      // Reset all per-model quotas
      GEMINI_MODELS.forEach(model => {
        updateData[`${model.id}_exhausted`] = false;
        updateData[`${model.id}_exhausted_date`] = null;
      });
      
      // Also reset legacy bucket quotas for compatibility
      ['tts', 'flash_2_5', 'flash_lite', 'pro_3_0', 'exp_pro'].forEach(bucket => {
        updateData[`${bucket}_quota_exhausted`] = false;
        updateData[`${bucket}_quota_exhausted_date`] = null;
      });

      const { error } = await supabase
        .from('api_keys')
        .update(updateData)
        .eq('provider', 'gemini');

      if (error) throw error;

      await fetchApiKeys();

      toast({
        title: 'Success',
        description: 'All model quotas reset',
      });
    } catch (error) {
      console.error('Error resetting all quotas:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset quotas',
        variant: 'destructive',
      });
    }
  };

  const getModelSummary = (modelId: string) => {
    const activeKeys = apiKeys.filter(k => k.is_active);
    const exhaustedKeys = activeKeys.filter(k => getModelQuotaStatus(k, modelId));
    return {
      total: activeKeys.length,
      available: activeKeys.length - exhaustedKeys.length,
      exhausted: exhaustedKeys.length,
    };
  };

  // Count total exhausted models across all keys
  const totalExhaustedCount = GEMINI_MODELS.reduce((count, model) => {
    return count + apiKeys.filter(k => k.is_active && getModelQuotaStatus(k, model.id)).length;
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Per-Model Quota Matrix */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-primary" />
              <div>
                <CardTitle>API Key × Model Quota Matrix</CardTitle>
                <CardDescription>
                  Track and manage quota exhaustion per model per API key. Toggle to manually mark/reset quotas.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {totalExhaustedCount > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-600">
                  {totalExhaustedCount} exhausted
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={refreshData} disabled={refreshing}>
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {totalExhaustedCount > 0 && (
                <Button variant="outline" size="sm" onClick={resetAllQuotas}>
                  Reset All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px] sticky left-0 bg-background z-10">API Key</TableHead>
                  <TableHead className="text-center w-[80px]">Status</TableHead>
                  {GEMINI_MODELS.map((model) => {
                    const summary = getModelSummary(model.id);
                    return (
                      <TableHead key={model.id} className="text-center min-w-[100px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col items-center gap-1 cursor-help">
                              <span className="text-xs font-medium">{model.displayName}</span>
                              <span className={`text-[10px] ${summary.exhausted > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                                {summary.available}/{summary.total}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <div className="space-y-1">
                              <p className="font-medium">{model.apiName}</p>
                              <p className="text-xs text-muted-foreground">{model.description}</p>
                              <p className="text-xs">
                                {summary.available} available, {summary.exhausted} exhausted
                              </p>
                              {summary.exhausted > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs w-full mt-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    resetAllQuotasForModel(model.id);
                                  }}
                                >
                                  Reset All {model.displayName}
                                </Button>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id} className={!key.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-sm sticky left-0 bg-background z-10">
                      {maskKey(key.key_value)}
                    </TableCell>
                    <TableCell className="text-center">
                      {key.is_active ? (
                        <Badge variant="outline" className="text-green-600 border-green-600 text-[10px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">
                          Off
                        </Badge>
                      )}
                    </TableCell>
                    {GEMINI_MODELS.map((model) => {
                      const isExhausted = getModelQuotaStatus(key, model.id);
                      return (
                        <TableCell key={model.id} className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Switch
                              checked={!isExhausted}
                              onCheckedChange={() => toggleModelQuota(key.id, model.id, isExhausted ?? false)}
                              disabled={!key.is_active}
                              className="scale-75"
                            />
                            {isExhausted ? (
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                            ) : (
                              <CheckCircle className="w-3 h-3 text-green-500" />
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {/* Legend */}
          <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              <span>Exhausted today</span>
            </div>
            <div className="flex items-center gap-1">
              <XCircle className="w-3 h-3 text-red-500" />
              <span>All models exhausted = key unusable</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
