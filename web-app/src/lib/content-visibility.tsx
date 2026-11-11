import * as React from 'react';

/**
 * Whether this subtree is presented to the user. A collapsed, inert or hidden wrapper that keeps its children mounted
 * (MotionExpandable) marks them not visible, so a control inside can tell it is mounted but unseen. Nested wrappers
 * combine: a subtree is visible only when every wrapper above it is.
 */
const ContentVisibleContext = React.createContext(true);

export function ContentVisibility({ visible, children }: { readonly visible: boolean; readonly children: React.ReactNode }): React.ReactElement {
  const parentVisible = React.useContext(ContentVisibleContext);
  return <ContentVisibleContext.Provider value={parentVisible && visible}>{children}</ContentVisibleContext.Provider>;
}

export function useContentVisible(): boolean {
  return React.useContext(ContentVisibleContext);
}
