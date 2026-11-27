import { verticalPath } from './flow';
import { VERTICAL_SHOPS } from './shops';

// seen-open-verticals-task.md, phase 0: the golden path of furniture.
verticalPath(VERTICAL_SHOPS.find((s) => s.vertical === 'furniture')!);
