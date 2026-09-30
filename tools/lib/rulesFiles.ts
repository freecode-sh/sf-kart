/**
 * The rules' data from disk (Node), ready to re-simulate runs with (src/app/rules/resim.ts): the
 * course the app races and the vehicle data. See rulesHashPlugin.ts for the files.
 */

import type { RulesData } from '../../src/app/rules/resim';
import { readRulesSources, REPO_ROOT, RULES_COURSE } from './rulesHashPlugin';

export { rulesFilePaths, RULES_COURSE } from './rulesHashPlugin';

export function loadRulesData(root = REPO_ROOT, course = RULES_COURSE): RulesData {
    return readRulesSources(root, course) as RulesData;
}
