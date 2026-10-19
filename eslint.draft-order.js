export const draftOrderRules = [
  { selector: "AssignmentPattern[left.name='draftType'][right.value='snake']",
    message: 'No default draft type. Use createSlotSequence with a required DraftFormat from @fantasy-draft/shared, implemented in shared/src/draft-order.ts.' },
  { selector: "LogicalExpression[operator='??'][right.value='snake']",
    message: 'No snake fallback. Use createSlotSequence with a required DraftFormat from @fantasy-draft/shared, implemented in shared/src/draft-order.ts.' },
];
