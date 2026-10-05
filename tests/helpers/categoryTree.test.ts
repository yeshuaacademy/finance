import { describe, expect, it } from 'vitest';
import { ensureCategoryIndex, filterCategoryTreeByActiveIds } from '../../src/helpers/category-tree';

describe('category tree helper', () => {
  it('builds a lookup map and sorted main categories', () => {
    const categories = [
      { id: 'main-z', name: 'Zending', parentId: null },
      { id: 'main-a', name: 'Administratie', parentId: null },
      { id: 'sub-b', name: 'Bankkosten', parentId: 'main-a' },
    ];

    const { map, tree } = ensureCategoryIndex(categories);

    expect(map.get('main-z')).toEqual({ id: 'main-z', name: 'Zending', parentId: null });
    expect(tree.main.map((category) => category.id)).toEqual(['main-a', 'main-z']);
  });

  it('groups and sorts subcategories by parent id', () => {
    const { tree } = ensureCategoryIndex([
      { id: 'sub-z', name: 'Zorg', parentId: 'main-1' },
      { id: 'sub-a', name: 'Aanschaf', parentId: 'main-1' },
      { id: 'sub-other', name: 'Overig', parentId: 'main-2' },
      { id: 'main-1', name: 'Uitgaven', parentId: null },
      { id: 'main-2', name: 'Inkomsten', parentId: null },
    ]);

    expect(tree.byParent['main-1']?.map((category) => category.id)).toEqual(['sub-a', 'sub-z']);
    expect(tree.byParent['main-2']?.map((category) => category.id)).toEqual(['sub-other']);
  });

  it('keeps additional category fields intact', () => {
    const categories = [{ id: 'main-1', name: 'Inkomsten', parentId: null, color: '#123456' }];
    const { map, tree } = ensureCategoryIndex(categories);

    expect(map.get('main-1')?.color).toBe('#123456');
    expect(tree.main[0]?.color).toBe('#123456');
  });

  it('omits archived transaction labels and keeps canonical active labels in the overview', () => {
    const { tree } = ensureCategoryIndex([
      { id: 'main:legacy', name: 'schenking FTK', parentId: null },
      { id: 'cat-legacy', name: 'schenking FTK', parentId: 'main:legacy' },
      { id: 'main:gifts', name: 'Schenking FTK', parentId: null },
      { id: 'cat-canonical', name: 'Schenking FTK', parentId: 'main:gifts' },
    ]);

    expect(filterCategoryTreeByActiveIds(
      tree,
      new Set(['cat-canonical']),
      new Map([['cat-canonical', 'Schenking FTK']]),
    )).toEqual({
      main: [{ id: 'main:gifts', name: 'Schenking FTK', parentId: null }],
      byParent: {
        'main:legacy': [],
        'main:gifts': [{ id: 'cat-canonical', name: 'Schenking FTK', parentId: 'main:gifts' }],
      },
    });
  });
});
