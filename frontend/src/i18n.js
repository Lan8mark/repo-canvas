export function normalizeLanguage(value) { return value === "en" ? "en" : "ru"; }

const copy = {
  ru: {
    now:"сейчас",sec:"{n} сек",min:"{n} мин",technicalRelation:"техническая связь",related:"связано",accessLost:"Canvas потерял локальный доступ",
    graphFailed:"Не удалось построить карту: {error}",areaMoved:"Область перемещена",positionSaved:"Позиция сохранена",resumeCopied:"Resume-команда скопирована: {command}",
    opening:"Открываю {title}",workSession:"рабочую сессию",nameSaved:"Название сохранено",roleSaved:"Уровень блока: {role}",regenerateConfirm:"Прочитать актуальное состояние репозитория и обновить карту?",
    rebuilding:"Architect перестраивает карту",alreadyRebuilding:"Перестройка уже идёт",mapUpdated:"Карта обновлена",error:"ошибка",loading:"строим пространство проекта…",offline:"нет связи с локальным Canvas",
    memory:"память проекта",products:"ПРОДУКТЫ",responsibilities:"ОТВЕТСТВЕННОСТИ",inWork:"В РАБОТЕ",online:"онлайн",noConnection:"нет связи",project:"ПРОЕКТ",wholeSystem:"Вся система",
    countResponsibilities:"{n} ответственностей",architecture:"АРХИТЕКТУРА И ТЕКУЩАЯ РАБОТА",wholeProject:"Весь проект",logic:"Смысл",technical:"Техника",informationLayer:"Слой информации",
    core:"Основа",support:"Поддержка",detail:"Деталь",all:"Всё",mapDepth:"Глубина карты",refresh:"Обновить",buildingMap:"Обновление…",regenerate:"Пересобрать",
    fit:"Вся карта",focus:"Фокус",incoming:"Входящие",outgoing:"Исходящие",reset:"Сбросить",bridge:"Мост",exactRelations:"{n} точных связей",
    active:"в работе",weight:"ВЕС НА КАРТЕ",goal:"Цель",solution:"Решение",goalMissing:"Цель пока не сформулирована.",solutionMissing:"Решение пока не сформулировано.",mechanismMissing:"Технический механизм пока не описан.",
    guarantees:"Гарантии",technicalBoundary:"Техническая граница",accepts:"Принимает",returns:"Возвращает",code:"Код",relations:"Связи",current:"Сейчас",rename:"Переименовать",
    affects:"Затрагивает",openSession:"Открыть сессию ↗",betweenProducts:"МЕЖДУ ПРОДУКТАМИ",bridgeExplanation:"Агрегированный мост убирает длинные рёбра из общего обзора. Здесь раскрыты все его точные связи.",
    exactRelationsTitle:"Точные связи",back:"Вернуться к обзору",selectNode:"Выберите ноду",selectNodeHelp:"Здесь появятся назначение, связи и текущая работа.",mapReady:"Карта готова",manualName:"РУЧНОЕ ИМЯ",cancel:"Отмена",save:"Сохранить",
    languageConfirm:"Переключить Canvas на русский и полностью пересобрать текст карты?",languageSwitchFailed:"Не удалось переключить язык",languageChanged:"Язык переключён, карта пересобирается",
    operational:"работает",planned:"план",problem:"проблема",disabled:"отключено",input:"Вход",output:"Выход",area:"Продукт",entity:"Ответственность",relation:"связь",
    nodeGoalMissing:"Цель этого блока пока не сформулирована.",nodeSolutionMissing:"Роль блока пока не сформулирована.",pathMissing:"путь не указан",areaUpper:"ПРОДУКТ",guarantee:"Гарантия",interpreting:"осмысляет",waiting:"ждёт",renameHint:"двойной клик для переименования",
  },
  en: {
    now:"now",sec:"{n} sec",min:"{n} min",technicalRelation:"technical relation",related:"related",accessLost:"Canvas lost local access",
    graphFailed:"Could not build the map: {error}",areaMoved:"Product moved",positionSaved:"Position saved",resumeCopied:"Resume command copied: {command}",
    opening:"Opening {title}",workSession:"work session",nameSaved:"Name saved",roleSaved:"Block level: {role}",regenerateConfirm:"Read the current repository state and update the map?",
    rebuilding:"Architect is rebuilding the map",alreadyRebuilding:"A rebuild is already running",mapUpdated:"Map updated",error:"error",loading:"building the project space…",offline:"no connection to local Canvas",
    memory:"project memory",products:"PRODUCTS",responsibilities:"RESPONSIBILITIES",inWork:"IN PROGRESS",online:"online",noConnection:"offline",project:"PROJECT",wholeSystem:"Whole system",
    countResponsibilities:"{n} responsibilities",architecture:"ARCHITECTURE AND CURRENT WORK",wholeProject:"Whole project",logic:"Meaning",technical:"Technical",informationLayer:"Information layer",
    core:"Core",support:"Support",detail:"Detail",all:"All",mapDepth:"Map depth",refresh:"Refresh",buildingMap:"Updating…",regenerate:"Rebuild",
    fit:"Whole map",focus:"Focus",incoming:"Incoming",outgoing:"Outgoing",reset:"Reset",bridge:"Bridge",exactRelations:"{n} exact relations",
    active:"in progress",weight:"MAP WEIGHT",goal:"Goal",solution:"Responsibility",goalMissing:"The goal has not been stated yet.",solutionMissing:"The responsibility has not been stated yet.",mechanismMissing:"The technical mechanism has not been described yet.",
    guarantees:"Guarantees",technicalBoundary:"Technical boundary",accepts:"Accepts",returns:"Returns",code:"Code",relations:"Relations",current:"Current",rename:"Rename",
    affects:"Affects",openSession:"Open session ↗",betweenProducts:"BETWEEN PRODUCTS",bridgeExplanation:"The aggregate bridge removes long edges from the overview. All exact relations are shown here.",
    exactRelationsTitle:"Exact relations",back:"Back to overview",selectNode:"Select a node",selectNodeHelp:"Its purpose, relations and current work will appear here.",mapReady:"Map ready",manualName:"MANUAL NAME",cancel:"Cancel",save:"Save",
    languageConfirm:"Switch Canvas to English and completely rebuild the map text?",languageSwitchFailed:"Could not switch language",languageChanged:"Language switched; the map is rebuilding",
    operational:"operational",planned:"planned",problem:"problem",disabled:"disabled",input:"Input",output:"Output",area:"Product",entity:"Responsibility",relation:"relation",
    nodeGoalMissing:"This block's goal has not been stated yet.",nodeSolutionMissing:"This block's responsibility has not been stated yet.",pathMissing:"path not specified",areaUpper:"PRODUCT",guarantee:"Guarantee",interpreting:"interpreting",waiting:"waiting",renameHint:"double-click to rename",
  },
};

export function t(language, key, values = {}) {
  const template = copy[normalizeLanguage(language)][key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}
