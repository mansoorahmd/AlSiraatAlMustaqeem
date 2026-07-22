export type RootStackParamList = {
  Home: undefined;
  MyMeanings: undefined;
  ReaderHome: undefined;
  Reader: { chapterId: number; focusVerseKey?: string; focusWordPos?: number };
  Search: undefined;
  RootsExplorer: undefined;
  RootDetail: { root: string }; // buckwalter key
  OpenQuestions: undefined;
  Trail: { root?: string; trailId?: number };
};
