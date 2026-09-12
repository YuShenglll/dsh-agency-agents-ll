/**
 * Division directory name → display name, in both languages.
 *
 * These are the 18 divisions the upstream repository declares, and nothing else:
 * the roster is defined entirely by what upstream ships.
 */

/** Division directory name → Chinese display name. */
export const ZH_DIVISION: Readonly<Record<string, string>> = {
  academic: '学术',
  design: '设计',
  engineering: '工程',
  finance: '金融',
  'game-development': '游戏开发',
  gis: '地理信息',
  healthcare: '医疗健康',
  marketing: '市场营销',
  'paid-media': '付费媒体',
  product: '产品',
  'project-management': '项目管理',
  research: '研究',
  sales: '销售',
  security: '安全',
  'spatial-computing': '空间计算',
  specialized: '专业',
  support: '支持',
  testing: '测试',
}

/** Division directory name → English display name. */
export const EN_DIVISION: Readonly<Record<string, string>> = {
  academic: 'Academic',
  design: 'Design',
  engineering: 'Engineering',
  finance: 'Finance',
  'game-development': 'Game Development',
  gis: 'GIS',
  healthcare: 'Healthcare',
  marketing: 'Marketing',
  'paid-media': 'Paid Media',
  product: 'Product',
  'project-management': 'Project Management',
  research: 'Research',
  sales: 'Sales',
  security: 'Security',
  'spatial-computing': 'Spatial Computing',
  specialized: 'Specialized',
  support: 'Support',
  testing: 'Testing',
}

/** Every division directory this plugin serves, in declaration order. */
export const DIVISIONS: readonly string[] = Object.keys(ZH_DIVISION)
