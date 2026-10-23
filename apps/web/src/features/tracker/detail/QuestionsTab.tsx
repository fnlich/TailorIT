'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { ApplicationDetail, ApplicationQuestion } from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { CaretDownIcon, CaretUpIcon, PlusIcon, QuestionIcon, TrashIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import { trackerApi, trackerKeys } from '../data';

/** One saved question: edited in place, saved when a field loses focus. */
function QuestionCard({
  question,
  index,
  count,
  onSave,
  onMove,
  onDelete,
}: {
  question: ApplicationQuestion;
  index: number;
  count: number;
  onSave: (id: string, patch: { question?: string; answer?: string }) => Promise<void>;
  onMove: (id: string, position: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(question.question);
  const [answer, setAnswer] = useState(question.answer);
  return (
    <li className="flex flex-col gap-2.5 rounded-control border border-border bg-surface p-4">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-6 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">{index + 1}.</span>
        <Input
          aria-label={`Question ${index + 1}`}
          value={text}
          maxLength={1000}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const next = text.trim();
            if (!next) setText(question.question);
            else if (next !== question.question) void onSave(question.id, { question: next });
          }}
        />
        <div className="flex shrink-0 items-center">
          <IconButton label="Move up" size="sm" icon={<CaretUpIcon size={14} />} disabled={index === 0} onClick={() => void onMove(question.id, index - 1)} />
          <IconButton
            label="Move down"
            size="sm"
            icon={<CaretDownIcon size={14} />}
            disabled={index === count - 1}
            onClick={() => void onMove(question.id, index + 1)}
          />
          <IconButton label="Delete question" size="sm" icon={<TrashIcon size={16} />} onClick={() => void onDelete(question.id)} />
        </div>
      </div>
      <div className="pl-8">
        <Textarea
          aria-label={`Answer to question ${index + 1}`}
          value={answer}
          autoGrow
          maxLength={20000}
          placeholder="Write your answer"
          onChange={(event) => setAnswer(event.target.value)}
          onBlur={() => {
            if (answer !== question.answer) void onSave(question.id, { answer });
          }}
        />
      </div>
    </li>
  );
}

/** "Application Questions": the questions an application asked and the answers given, in order. */
export function QuestionsTab({ application }: { application: ApplicationDetail }) {
  const client = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const id = application.id;

  const refresh = () => client.invalidateQueries({ queryKey: trackerKeys.detail(id) });

  /** True when the change was saved. */
  const run = async (work: () => Promise<unknown>, failure: string): Promise<boolean> => {
    try {
      await work();
      await refresh();
      return true;
    } catch (error) {
      toast.error(userMessage(error, failure));
      return false;
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!newQuestion.trim()) return;
    setBusy(true);
    const saved = await run(
      () => trackerApi.addQuestion(id, newQuestion.trim(), newAnswer),
      "We couldn't add the question. Please try again.",
    );
    setBusy(false);
    // A failed save keeps what was typed.
    if (!saved) return;
    setNewQuestion('');
    setNewAnswer('');
    setAdding(false);
  };

  const questions = application.questions;
  return (
    <section aria-labelledby="questions-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="questions-heading" className="text-base font-semibold text-foreground">
          Application Questions
        </h3>
        {!adding && (
          <Button variant="outline" size="sm" icon={<PlusIcon size={14} />} onClick={() => setAdding(true)}>
            Add Question
          </Button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-control border border-border bg-surface-low p-4" aria-label="New question">
          <Input
            aria-label="Question"
            placeholder="Question, e.g. Why do you want to work here?"
            value={newQuestion}
            maxLength={1000}
            autoFocus
            onChange={(event) => setNewQuestion(event.target.value)}
          />
          <Textarea
            aria-label="Answer"
            placeholder="Your answer"
            value={newAnswer}
            autoGrow
            maxLength={20000}
            onChange={(event) => setNewAnswer(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={!newQuestion.trim()}>
              Save question
            </Button>
          </div>
        </form>
      )}
      {questions.length === 0 && !adding ? (
        <div className="rounded-control border border-dashed border-border">
          <EmptyState
            size="sm"
            icon={<QuestionIcon size={20} />}
            title="No questions yet"
            description="Keep the questions this application asked, and your answers, for the next round."
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {questions.map((question, index) => (
            <QuestionCard
              // Keyed by id only: a save refetches the detail, and the card must keep its typing and focus.
              key={question.id}
              question={question}
              index={index}
              count={questions.length}
              onSave={async (questionId, patch) => {
                await run(() => trackerApi.patchQuestion(id, questionId, patch), "We couldn't save the question.");
              }}
              onMove={async (questionId, position) => {
                await run(() => trackerApi.patchQuestion(id, questionId, { position }), "We couldn't move the question.");
              }}
              onDelete={async (questionId) => {
                await run(() => trackerApi.deleteQuestion(id, questionId), "We couldn't delete the question.");
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
