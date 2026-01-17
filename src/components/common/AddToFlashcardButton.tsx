import { useState } from 'react';
import { Plus, Loader2, Check, BookOpen, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface AddToFlashcardButtonProps {
  word?: string;
  meaning?: string;
  example?: string;
  variant?: 'icon' | 'button' | 'inline';
  className?: string;
  onSuccess?: () => void;
}

export function AddToFlashcardButton({ 
  word = '', 
  meaning = '', 
  example = '',
  variant = 'button',
  className,
  onSuccess 
}: AddToFlashcardButtonProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [formData, setFormData] = useState({
    word: word,
    meaning: meaning,
    example: example,
    deckId: ''
  });

  // Fetch user's decks
  const { data: decks = [], refetch: refetchDecks } = useQuery({
    queryKey: ['flashcard-decks', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('flashcard_decks')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && open
  });

  const handleCreateDeck = async () => {
    if (!user || !newDeckName.trim()) {
      toast.error('Please enter a deck name');
      return;
    }

    setIsSaving(true);
    try {
      const { data: newDeck, error } = await supabase
        .from('flashcard_decks')
        .insert({
          user_id: user.id,
          name: newDeckName.trim(),
          description: 'Custom vocabulary deck'
        })
        .select('id')
        .single();

      if (error) throw error;

      await refetchDecks();
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks', user.id] });
      setFormData(prev => ({ ...prev, deckId: newDeck.id }));
      setNewDeckName('');
      setIsCreatingDeck(false);
      toast.success('Deck created!');
    } catch (error) {
      console.error('Error creating deck:', error);
      toast.error('Failed to create deck');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!user) {
      toast.error('Please log in to save flashcards');
      return;
    }

    if (!formData.word.trim() || !formData.meaning.trim()) {
      toast.error('Word and meaning are required');
      return;
    }

    let deckId = formData.deckId;

    // If no deck selected, create a default one
    if (!deckId) {
      const { data: newDeck, error: deckError } = await supabase
        .from('flashcard_decks')
        .insert({
          user_id: user.id,
          name: 'My Vocabulary',
          description: 'Words collected from reading and listening practice'
        })
        .select('id')
        .single();

      if (deckError) {
        console.error('Error creating deck:', deckError);
        toast.error('Failed to create deck');
        return;
      }
      deckId = newDeck.id;
      await refetchDecks();
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('flashcard_cards')
        .insert({
          user_id: user.id,
          deck_id: deckId,
          word: formData.word.trim(),
          meaning: formData.meaning.trim(),
          example: formData.example.trim() || null,
          status: 'learning'
        });

      if (error) throw error;

      setSaved(true);
      toast.success('Added to flashcards!');
      onSuccess?.();
      
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
      }, 1000);
    } catch (error) {
      console.error('Error saving flashcard:', error);
      toast.error('Failed to save flashcard');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset form when opening
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setFormData({
        word: word,
        meaning: meaning,
        example: example,
        deckId: decks[0]?.id || ''
      });
      setSaved(false);
    }
  };

  const buttonContent = () => {
    if (saved) {
      return <Check size={16} className="text-success" />;
    }
    if (variant === 'icon') {
      return <Plus size={16} />;
    }
    return (
      <>
        <BookOpen size={16} />
        <span>Add to Flashcards</span>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button 
          variant={variant === 'inline' ? 'link' : 'outline'} 
          size={variant === 'icon' ? 'icon' : 'sm'}
          className={className}
        >
          {buttonContent()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen size={20} className="text-primary" />
            Add to Flashcards
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="word">Word/Phrase</Label>
            <Input 
              id="word"
              value={formData.word}
              onChange={(e) => setFormData(prev => ({ ...prev, word: e.target.value }))}
              placeholder="Enter word or phrase"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="meaning">Meaning/Definition</Label>
            <Textarea 
              id="meaning"
              value={formData.meaning}
              onChange={(e) => setFormData(prev => ({ ...prev, meaning: e.target.value }))}
              placeholder="Enter meaning or definition"
              rows={3}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="example">Example (optional)</Label>
            <Textarea 
              id="example"
              value={formData.example}
              onChange={(e) => setFormData(prev => ({ ...prev, example: e.target.value }))}
              placeholder="Enter an example sentence"
              rows={2}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="deck">Deck</Label>
            {isCreatingDeck ? (
              <div className="flex gap-2">
                <Input
                  placeholder="New deck name"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateDeck();
                    }
                  }}
                  autoFocus
                />
                <Button 
                  type="button" 
                  size="sm" 
                  onClick={handleCreateDeck}
                  disabled={isSaving || !newDeckName.trim()}
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
                </Button>
                <Button 
                  type="button" 
                  size="sm" 
                  variant="ghost"
                  onClick={() => {
                    setIsCreatingDeck(false);
                    setNewDeckName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select 
                  value={formData.deckId} 
                  onValueChange={(value) => setFormData(prev => ({ ...prev, deckId: value }))}
                >
                  <SelectTrigger id="deck" className="flex-1">
                    <SelectValue placeholder={decks.length > 0 ? "Select a deck" : "No decks yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {decks.map((deck) => (
                      <SelectItem key={deck.id} value={deck.id}>
                        {deck.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  type="button" 
                  size="icon" 
                  variant="outline"
                  onClick={() => setIsCreatingDeck(true)}
                  title="Create new deck"
                >
                  <FolderPlus size={16} />
                </Button>
              </div>
            )}
          </div>
          
          <Button 
            onClick={handleSave} 
            disabled={isSaving || saved}
            className="w-full gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check size={16} />
                Saved!
              </>
            ) : (
              <>
                <Plus size={16} />
                Add to Flashcards
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
