/**
 * 四种语言。实现在 can-ui（`createSiteI18n`），缺键回退简体。
 *
 * 词典：`frame` 是外壳文案，`apiDocs`、`dev` 是本站自己的。
 * cookie 是 `NEXT_LOCALE`，在父域上共享。
 */
import {
  createSiteI18n,
  createTranslator,
  type Locale,
  type Translator,
} from "@jianyuelab-org/can-ui/i18n";
import enUs from "../../language/en-us.json";
import jaJp from "../../language/ja-jp.json";
import zhCn from "../../language/zh-cn.json";
import zhTw from "../../language/zh-tw.json";

export { createTranslator, type Locale, type Translator };
export const {
  LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  getLocale,
  useTranslations,
  getMessages,
} = createSiteI18n({
  "zh-cn": zhCn,
  "zh-tw": zhTw,
  "en-us": enUs,
  "ja-jp": jaJp,
});
