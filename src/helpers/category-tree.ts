export type CategoryLike = {
  id: string;
  name: string;
  parentId: string | null;
  color?: string | null;
};

export type CategoryTree<TCategory extends CategoryLike = CategoryLike> = {
  main: TCategory[];
  byParent: Record<string, TCategory[]>;
};

export const filterCategoryTreeByActiveIds = <TCategory extends CategoryLike>(
  tree: CategoryTree<TCategory>,
  activeIds: ReadonlySet<string>,
  activeNames: ReadonlyMap<string, string> = new Map(),
): CategoryTree<TCategory> => {
  const byParent = Object.fromEntries(
    Object.entries(tree.byParent).map(([parentId, children]) => [
      parentId,
      children
        .filter((category) => activeIds.has(category.id))
        .map((category) => ({
          ...category,
          name: activeNames.get(category.id) ?? category.name,
        })),
    ]),
  );
  const main = tree.main
    .filter((category) => activeIds.has(category.id) || (byParent[category.id]?.length ?? 0) > 0)
    .map((category) => ({
      ...category,
      name: activeNames.get(category.id) ?? category.name,
    }));

  return { main, byParent };
};

export const ensureCategoryIndex = <TCategory extends CategoryLike>(
  categories: TCategory[],
): { map: Map<string, TCategory>; tree: CategoryTree<TCategory> } => {
  const map = new Map<string, TCategory>();
  const byParent: Record<string, TCategory[]> = {};

  categories.forEach((category) => {
    map.set(category.id, category);
    if (category.parentId) {
      if (!byParent[category.parentId]) {
        byParent[category.parentId] = [];
      }
      byParent[category.parentId]!.push(category);
    }
  });

  const main = categories.filter((category) => !category.parentId).sort((a, b) => a.name.localeCompare(b.name));
  Object.values(byParent).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  return {
    map,
    tree: {
      main,
      byParent,
    },
  };
};
