export interface OutlineData {
  [key: string]: unknown;
  book_id: string;
  title: string;
  items: OutlineItem[];
  structure?: OutlineItem[];
}

export interface OutlineItem {
  id: string;
  kind: 'theme' | 'topic' | 'lesson' | 'activity' | 'review' | 'chunk';
  label: string;
  title: string;
  page_start: number;
  page_end?: number;
  md_start?: number;
  md_end?: number;
  order_path: string;
  parent_id?: string;
  source_ids?: string[];
  children?: OutlineItem[];
}
