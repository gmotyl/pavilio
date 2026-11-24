import { createContext } from "react";

/**
 * Records a comment speech key a marker started, with the function that stops it. The file viewer
 * provides it and stops them all when it leaves the file: a marker remounts whenever the table
 * does (Split ↔ Unified, Diff ↔ Code, a narrowing pane), which must not cut its comment off.
 */
export type TrackCommentSpeech = (key: string, stop: (key: string) => void) => void;

export const CommentSpeechScope = createContext<TrackCommentSpeech | null>(null);
