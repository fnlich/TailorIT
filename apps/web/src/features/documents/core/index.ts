// The generic documents layer: presentation only, no data fetching. Resumes, Cover Letters and Templates tabs build
// on it with their own loaders, columns, cards and menu items.
export { ActionMenu, type ActionMenuProps } from './ActionMenu';
export { BulkDeleteDialog } from './BulkDeleteDialog';
export { DocumentNameCell, TableRowActions, TextCell } from './cells';
export { DocumentCard, type DocumentCardProps } from './DocumentCard';
export { DocumentCollection, type CardRenderContext, type DocumentCollectionProps } from './DocumentCollection';
export { DocumentList, type DocumentListProps, type DocumentListVariant } from './DocumentList';
export { DocumentThumb, type DocumentThumbProps } from './DocumentThumb';
export { focusDocument, neighbourOf } from './focusAfterRemoval';
export {
  bulkDeleteSentence,
  describeMatches,
  matchesQuery,
  newestFirst,
  noMatchTitle,
  thumbKey,
  titleCase,
} from './gallery';
export { NewTile, type NewTileProps } from './NewTile';
export { PageThumb, ThumbLoading, ThumbState } from './PageThumb';
export { RenameDialog, type RenameDialogProps } from './RenameDialog';
export { SearchBox } from './SearchBox';
export { THUMB_CACHE_SIZE, cachedThumb, forgetThumbs, loadThumb, type ThumbPage } from './thumbCache';
export {
  PAGE_A4,
  PAGE_LETTER,
  type ActionMenuItem,
  type DocumentColumn,
  type DocumentKind,
  type Noun,
  type PageSize,
  type ViewMode,
} from './types';
export { useSelection, type Selection } from './useSelection';
export { useViewMode, ViewToggle } from './ViewToggle';
