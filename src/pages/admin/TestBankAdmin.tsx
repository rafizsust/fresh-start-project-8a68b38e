import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Database, 
  Trash2,
  RefreshCw, 
  Eye,
  EyeOff,
  Play,
  BookOpen,
  Headphones,
  PenTool,
  Mic,
  Search,
  Calendar,
  Filter,
  Sparkles,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import TestBankRecommendations from '@/components/admin/TestBankRecommendations';

interface GeneratedTest {
  id: string;
  module: string;
  topic: string;
  difficulty: string;
  question_type: string | null;
  status: string;
  is_published: boolean;
  accent: string | null;
  voice_id: string | null;
  audio_url: string | null;
  transcript: string | null;
  content_payload: any;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  job_id: string | null;
}

const MODULE_ICONS: Record<string, any> = {
  reading: BookOpen,
  listening: Headphones,
  writing: PenTool,
  speaking: Mic,
};

const MODULE_COLORS: Record<string, string> = {
  reading: 'bg-blue-500/10 text-blue-600',
  listening: 'bg-purple-500/10 text-purple-600',
  writing: 'bg-emerald-500/10 text-emerald-600',
  speaking: 'bg-orange-500/10 text-orange-600',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-success/10 text-success border-success/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  hard: 'bg-destructive/10 text-destructive border-destructive/30',
};

const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  pending: 'bg-warning/10 text-warning',
};

export default function TestBankAdmin() {
  const [tests, setTests] = useState<GeneratedTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterModule, setFilterModule] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDifficulty, setFilterDifficulty] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [previewTest, setPreviewTest] = useState<GeneratedTest | null>(null);
  const { toast } = useToast();

  const fetchTests = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('generated_test_audio')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply module filter
      if (filterModule !== 'all') {
        query = query.eq('module', filterModule);
      }

      // Apply status filter
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      // Apply difficulty filter
      if (filterDifficulty !== 'all') {
        query = query.eq('difficulty', filterDifficulty);
      }

      // Apply date filter
      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate: Date;
        switch (dateFilter) {
          case 'today':
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case 'week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case 'month':
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          default:
            startDate = new Date(0);
        }
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      // Apply search filter client-side
      let filteredData = data || [];
      if (searchQuery.trim()) {
        const search = searchQuery.toLowerCase();
        filteredData = filteredData.filter(
          (t) =>
            t.topic?.toLowerCase().includes(search) ||
            t.question_type?.toLowerCase().includes(search)
        );
      }

      setTests(filteredData);
    } catch (error) {
      console.error('Error fetching tests:', error);
      toast({
        title: 'Error',
        description: 'Failed to load generated tests',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [filterModule, filterStatus, filterDifficulty, dateFilter, searchQuery, toast]);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  const togglePublishStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('generated_test_audio')
        .update({ is_published: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      setTests((prev) =>
        prev.map((test) =>
          test.id === id ? { ...test, is_published: !currentStatus } : test
        )
      );

      toast({
        title: 'Success',
        description: `Test ${!currentStatus ? 'published' : 'unpublished'}`,
      });
    } catch (error) {
      console.error('Error toggling publish status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update publish status',
        variant: 'destructive',
      });
    }
  };

  const deleteTest = async (id: string) => {
    try {
      const { error } = await supabase
        .from('generated_test_audio')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setTests((prev) => prev.filter((test) => test.id !== id));

      toast({
        title: 'Success',
        description: 'Test deleted',
      });
    } catch (error) {
      console.error('Error deleting test:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete test',
        variant: 'destructive',
      });
    }
  };

  const publishedCount = tests.filter((t) => t.is_published).length;
  const readyCount = tests.filter((t) => t.status === 'ready').length;

  // Counts computed above

  return (
    <div className="p-6 bg-gradient-to-br from-background via-background to-primary/5 min-h-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-accent">
            <Database className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold font-heading">Generated Tests</h1>
            <p className="text-muted-foreground">
              Manage AI-generated tests for test-takers
            </p>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="bank" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="bank" className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Test Bank
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Recommendations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations">
          <TestBankRecommendations />
        </TabsContent>

        <TabsContent value="bank">

      {/* Filters */}
      <Card className="border-0 shadow-lg mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by topic..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={filterModule} onValueChange={setFilterModule}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Module" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Modules</SelectItem>
                  <SelectItem value="reading">Reading</SelectItem>
                  <SelectItem value="listening">Listening</SelectItem>
                  <SelectItem value="writing">Writing</SelectItem>
                  <SelectItem value="speaking">Speaking</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-28">
                  <SelectValue placeholder="Date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={fetchTests}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tests Table */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="text-primary" />
              Generated Tests ({tests.length})
            </CardTitle>
            <CardDescription>
              {readyCount} ready, {publishedCount} published
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : tests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No generated tests found</p>
              <p className="text-sm">
                Use the Test Factory to bulk generate tests
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map((test) => {
                  const ModuleIcon = MODULE_ICONS[test.module] || BookOpen;
                  return (
                    <TableRow key={test.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-1.5 rounded ${MODULE_COLORS[test.module]}`}
                          >
                            <ModuleIcon className="w-4 h-4" />
                          </div>
                          <span className="capitalize">{test.module}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {test.topic}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {test.question_type || 'mixed'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={DIFFICULTY_COLORS[test.difficulty]}
                        >
                          {test.difficulty}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[test.status]}>
                          {test.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            togglePublishStatus(test.id, test.is_published)
                          }
                          className={
                            test.is_published
                              ? 'text-green-600'
                              : 'text-muted-foreground'
                          }
                        >
                          {test.is_published ? (
                            <>
                              <Eye className="w-4 h-4 mr-1" />
                              Yes
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-4 h-4 mr-1" />
                              No
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {test.times_used}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(test.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreviewTest(test)}
                          >
                            <Play className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Test?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently remove this generated test.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteTest(test.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={!!previewTest} onOpenChange={() => setPreviewTest(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewTest && (
                <>
                  <Badge className={MODULE_COLORS[previewTest.module]}>
                    {previewTest.module}
                  </Badge>
                  <span>{previewTest.topic}</span>
                  <Badge variant="outline">{previewTest.question_type}</Badge>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            {previewTest && (
              <div className="space-y-4 p-4">
                {/* Meta info */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Difficulty:</span>{' '}
                    <Badge variant="outline" className={DIFFICULTY_COLORS[previewTest.difficulty]}>
                      {previewTest.difficulty}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Accent:</span>{' '}
                    {previewTest.accent || 'N/A'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Voice:</span>{' '}
                    {(previewTest.content_payload?.tts_speaker_voices
                      ? Object.values(previewTest.content_payload.tts_speaker_voices).join(' + ')
                      : previewTest.voice_id) || 'N/A'}
                  </div>
                </div>

                {/* Audio player for listening/speaking */}
                {previewTest.audio_url && (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-2">Audio</p>
                    <audio controls className="w-full" src={previewTest.audio_url}>
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}

                {/* Transcript */}
                {previewTest.transcript && (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-2">Transcript</p>
                    <pre className="whitespace-pre-wrap text-sm">
                      {previewTest.transcript}
                    </pre>
                  </div>
                )}

                {/* Content payload */}
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">Content Payload</p>
                  <pre className="whitespace-pre-wrap text-xs overflow-auto max-h-[300px]">
                    {JSON.stringify(previewTest.content_payload, null, 2)}
                  </pre>
                </div>

                {/* Speaking audio URLs */}
                {previewTest.content_payload?.audioUrls && (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-2">Speaking Audio Files</p>
                    <div className="space-y-2">
                      {Object.entries(previewTest.content_payload.audioUrls).map(
                        ([key, url]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-32">
                              {key}
                            </span>
                            <audio controls className="h-8 flex-1" src={url as string}>
                              Audio
                            </audio>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
