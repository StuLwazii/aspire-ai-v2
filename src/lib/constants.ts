export const DEPARTMENT_OPTIONS = ["Engineering", "Sales", "Marketing", "HR", "Finance", "Operations", "Other"] as const;
export type Department = (typeof DEPARTMENT_OPTIONS)[number];
