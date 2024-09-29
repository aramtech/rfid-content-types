import type { ApiInterface } from "../api-client";

// #region utils
/**
 * a text mapper returns a string that represents content should be shown from given item
 * for example we have the item
 * ```ts
 * const person = {name: "John Doe", personalProperties: { age: 26 } }
 * ```
 * and i want to show it as "John Dow is 26 years old" which will be as follow
 *
 * ```js
 *  [
 *      {
 *          values: ["name"],
 *          matchedString: "{0}",
 *          notMatchedString: "Person name is not defined"
 *      },
 *      {
 *          values: ["personalProperties.age", "name"], // mapped values on the object that all must exist (and condition) to show value
 *          matchedString: "is {0} years old", // if all values exists and show condition satisfied
 *          notMatchedString: "" // if condition is not satisfied
 *      },
 *      "yeahhhhh"
 *
 *  ] // => "john doe is 26 years old yeahhhhh" | "person name is not defined yeahhhh"
 * ```
 */
type TextMapper =
    | (
          | {
                values: string[];
                matchedString: string;
                notMatchingString: string;
            }
          | string
      )[]
    | null;

const processTextMapper = (textMapper: TextMapper, target: any): string => {
    let processedTextList = [] as string[];
    for (const item of textMapper || []) {
        if (typeof item == "string") {
            processedTextList.push(item);
        } else {
            const matchedValues = item.values
                .map((vMapper) => {
                    return recursiveSelect(vMapper, target);
                })
                .filter((t) => t !== undefined);
            if (matchedValues.length == item.values.length) {
                const formattedText = item.matchedString.replaceAll(
                    /\{([0-9]+)\}/g,
                    (match: string, indexMatch: string) => {
                        console.log("replace Match", indexMatch);
                        const index = Number(indexMatch);
                        const unknownReplacement = "<unknown>";

                        if (Number.isNaN(index)) {
                            return unknownReplacement;
                        } else {
                            return matchedValues[index] || unknownReplacement;
                        }
                    }
                );
                processedTextList.push(formattedText);
            } else {
                processedTextList.push(item.notMatchingString);
            }
        }
    }
    return processedTextList.join(" ");
};

const isWeb = () => {
    try {
        return !!window;
    } catch (error) {
        return false;
    }
};
const onWeb = isWeb();

export function recursiveSelect(selector: string | Array<string>, obj: any): any {
    if (typeof selector == "string") {
        selector = selector.split(".").filter((s) => !!s);
    }

    if (!selector || !selector.length) {
        return obj;
    }
    try {
        return recursiveSelect(selector.slice(1), obj[selector[0]]);
    } catch (error) {
        // console.log("Recursive select error", error);
        return undefined;
    }
}

const recursiveLookup = (
    lookupMap: string | string[],
    lookingForValue: string | number,
    target: any,
    parent: any = undefined
) => {
    if (typeof lookupMap == "string") {
        lookupMap = lookupMap.split(".");
    }
    if (target === null || target === undefined) {
        return null;
    }
    const setParent = (obj: any) => {
        if (!obj) {
            return;
        }
        let lastParent = obj as any;
        while (lastParent?.parent) {
            lastParent = lastParent.parent;
        }
        if (lastParent !== target) {
            lastParent.parent = target;
        }
    };
    if (typeof target == "object") {
        if (Array.isArray(target)) {
            if (lookupMap[0] != "[]") {
                return null;
            }
            let result = null as any;
            for (const item of target) {
                const match = recursiveLookup(lookupMap.slice(1), lookingForValue, item, target);
                if (match) {
                    result = match;
                    break;
                }
            }
            setParent(result);
            return result;
        } else {
            const result = recursiveLookup(
                lookupMap.slice(1),
                lookingForValue,
                recursiveSelect(lookupMap[0], target),
                target
            );
            setParent(result);
            return result;
        }
    } else if (!lookupMap.length) {
        if (typeof target == "string" || typeof target == "number") {
            if (target == lookingForValue) {
                return parent;
            }
        }
    }
    return null;
};

export type BatcherOptions =
    | {
          onlyOnce: false;
          periodInMs: number;
      }
    | {
          onlyOnce: true;
          periodInMs: number;
      };
export const createBatcher = <T>(
    cb: (props?: T[]) => any,
    id: string,
    options: BatcherOptions = {
        onlyOnce: false,
        periodInMs: 300,
    }
) => {
    let timeout = null as any;
    let last_updated = -Infinity;
    const batched = [] as T[];
    const call_cb = async (props?: T[]): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(async () => {
                try {
                    await cb(props);
                } catch (error) {
                    console.log("Batch error, ID: ", id, "\nError:", error);
                }
                resolve();
            }, 50);
        });
    };

    const scheduleTimeout = (): Promise<void> => {
        return new Promise((resolve) => {
            timeout = setTimeout(async () => {
                last_updated = Date.now();
                await call_cb(batched.splice(0));
                timeout = null;
                resolve();
            }, options.periodInMs + 7);
        });
    };

    return {
        set: async (props?: T): Promise<void> => {
            return new Promise(async (resolve) => {
                if (props) {
                    batched.push(props);
                }

                if (
                    !options.onlyOnce &&
                    ((timeout && Date.now() - last_updated > options.periodInMs) || Date.now() - last_updated > 3e3)
                ) {
                    last_updated = Date.now();
                    await call_cb(batched.splice(0));
                } else {
                    clearTimeout(timeout);
                    await scheduleTimeout();
                }
                resolve();
            });
        },
        async set_now(props?: T) {
            props && batched.push(props);
            try {
                await cb(batched.splice(0));
            } catch (error) {
                console.log("Batch error", error);
            }
        },
        clear_timeout_handler() {
            clearTimeout(timeout);
        },
    };
};
// #endregion

// #region BodyInputs
type BodyInputDatePicker = {
    type: "datepicker";
    label: string;
    bodyKey: string;
    range: "afterNow" | "beforeNow" | "any";
};

type BodyInputTextInput = {
    type: "textInput";
    label: string;
    bodyKey: string;
    inputType: "password" | "number" | "text";
};

type BodyInputAutocomplete = {
    type: "autocomplete";
    data?: any[];
    autocompleteType: "data" | "api";
    textMapper: TextMapper;
    valueMapper: string | null;
    bodyKey: string;
    fetchUrlPath?: string;
    fetchMapper?: string | null;
    label: string;
};

type BodyInputCombobox = {
    type: "combobox";
    data?: any[];
    comboboxType: "data" | "api";
    textMapper: string | null;
    bodyKey: string;
    fetchUrlPath?: string;
    fetchMapper?: string | null;
    label: string;
};

type Rule = {
    ruleName: string;
    params: any[];
};

type BodyInput = { rules?: Rule[] } & (
    | BodyInputAutocomplete
    | BodyInputDatePicker
    | BodyInputTextInput
    | BodyInputCombobox
);
// #endregion

// #region content types

// #region content types base
type ContentTypeBase = {
    contentTypeId: number;
    display: string;
    name: string;
};
// #endregion

// #region legacy content type
type LegacyImplementation = {
    type: "legacy";
    name: string;
    display: string;
    content_type_id: number;
    fetchAllUrl?: null | string;
    fetchMapper?: string;
    textMapper?: null | string[];
    valueMapper?: string;
    fetch_on_submit?: boolean;
    submit_text?: string;
    body_requirements?: {
        type: string;
        required?: boolean;
        display: string;
        body_value: string;
        rules?: { rule_name: string; params?: any }[];
    }[];
};
// #endregion

// #region enum content type
type EnumValue = {
    text: string;
    value: number;
};
type EnumContentType = ContentTypeBase & {
    type: "enum";
    values: EnumValue[];
};
// #endregion

// #region fixed content type
type FixedContentType = ContentTypeBase & {
    type: "fixed";
    value: number;
    /**
     * which a string could be containing [TagEpc] or [TagContentTypeId] or [TagContentValue] literal will be relaced with its curresponding value as replacement on evaluation
     */
    textFormatter: string; // which a string could be containing [TagEpc] or [TagContentTypeId] or [TagContentValue] literal will be relaced with its curresponding value as replacement on evaluation
};
// #endregion

// #region manual content type

type ManualContentType = ContentTypeBase & {
    type: "manual";
    /**
     *  which a string could be containing [TagEpc] or [TagContentTypeId] or [TagContentValue] literal will be relaced with its curresponding value as replacement on evaluation
     */
    textFormatter: string;
};

// #endregion

// #region fetchedList content type
type FetchedListContentType = ContentTypeBase & {
    type: "fetchedList";
    fetchedListUrl: string;
    fetchMapper: string | null;
    textMapper: TextMapper;
    valueMapper: string | null;
};
// #endregion

// #region deferred content type
type DeferredWritingAnyValue = {
    type: "anyValue";
};

type DeferredWritingVerifiedValue =
    | {
          type: "verifiedValue";
          verifyType: "onSuccess";
          verificationUrlPath: string;
          bodyKey: string;
          submitVerificationText?: string;
      }
    | {
          type: "verifiedValue";
          verifyType: "onMatchFromList";
          verificationUrlPath: string;
          bodyKey: string;
          submitVerificationText?: string;
          matchFetchMapper: null | string;
          matchValueLookUpMapper: null | string;
      };

type DeferredWritingFromFetchedList = {
    type: "fromFetchedList";
    fetchUrl: string;
    fetchMapper: string | null;
    textMapper: TextMapper;
    valueMapper: string | null;
    fetchButtonText?: string;
    body?: BodyInput[];
};

type DeferredWriting = DeferredWritingVerifiedValue | DeferredWritingAnyValue | DeferredWritingFromFetchedList;

type DeferredReading =
    | {
          type: "batched";
          fetchUrlPath: string;
          bodyKeyForValuesList: string;
          fetchMapper: string | null;
          batchUniqueMatchMapper: string | null;
          valueMapper: string | null;
          textMapper: TextMapper;
      }
    | {
          type: "single";
          urlPath: string;
          bodyKey: string;
          valueMapper: string | null;
          textMapper: TextMapper;
      };

type DeferredContentType = ContentTypeBase & {
    type: "deferred";
    reading: DeferredReading;
    writing: DeferredWriting;
};
// #endregion

export type TagContentType =
    | FixedContentType
    | ManualContentType
    | EnumContentType
    | DeferredContentType
    | LegacyImplementation
    | FetchedListContentType;

// #endregion

type TagContentTypeWithData = { data?: any[] } & TagContentType;

type LoadTagsContentProps = {
    apiClient: ApiInterface<any, any, any, any>;
    now: boolean;
    path: string;
};

export const loadContentTypes = async (props: LoadTagsContentProps) => {
    const Api = props.apiClient;
    const tagContentTypes: TagContentTypeWithData[] = (
        await Api.post(
            props.path,
            {
                legacy: false,
            },
            {
                sinceMins: 3 * 24 * 60,
                now: props.now,
            }
        )
    ).data;
    for (const contentType of tagContentTypes) {
        if (contentType.type == "fetchedList") {
            const data = recursiveSelect(
                contentType.fetchedListUrl,
                (
                    await Api.post(contentType.fetchedListUrl, null, {
                        sinceMins: 3 * 24 * 60,
                        now: props.now,
                    })
                ).data
            );
            contentType.data = data;
        }
    }
    return tagContentTypes;
};

export const getTagNumbers = (tagEpc: string): null | [number, number] => {
    const numbers = tagEpc
        .slice(0, 16)
        .match(/.{1,8}/g)
        ?.map((i) => {
            return parseInt(i, 16);
        });
    if (!numbers || numbers?.length < 2) {
        return null;
    }
    return [numbers[0], numbers[1]];
};

type TagInfoBase = {
    text: string;
    contentTypeId: number;
    contentValue: number;
};

type TagDeferredInfo = {
    contentType: DeferredContentType;
    type: "deferred";
    fetch?: () => Promise<{
        value: any;
        text: string;
        display: string;
    } | null>;
};

type TagManualInfo = {
    type: "manual";
    contentType: ManualContentType;
};

type TagFixedInfo = {
    type: "fixed";
    contentType: FixedContentType;
};

type TagFetchedListInfo = {
    type: "fetchedList";
    contentType: FetchedListContentType & { data?: any[] };
    value: any;
    display: string;
    text: string;
};

type TagEnumInfo = {
    type: "enum";
    contentType: EnumContentType;
    value: EnumValue;
};

type TagInfoContent = TagDeferredInfo | TagManualInfo | TagFixedInfo | TagFetchedListInfo | TagEnumInfo;
type TagInfo = TagInfoBase & TagInfoContent;

export type Merge<T, U> = T & Omit<U, keyof T>;

type FindTagProps = {
    tagEpc: string;
    tagContentTypes: TagContentTypeWithData[];
    apiClient?: ApiInterface<any, any, any, any>;
};

type CachedBatchedItems = {
    [url: string]: {
        cache: any[];
        processedValues: number[];
        batcher: ReturnType<typeof createBatcher<number>>;
    };
};


const cachedBatchedItems: CachedBatchedItems = {};
const getDeferredTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
}: FindTagProps & {
    tagContentType: DeferredContentType;
    contentTypeId: number;
    contentValue: number;
}): (TagDeferredInfo & TagInfoBase) | null => {
    return {
        contentType: tagContentType,
        contentTypeId,
        contentValue,
        fetch: !apiClient
            ? undefined
            : async (now: boolean = !onWeb) => {
                  if (!apiClient) {
                      return null;
                  }
                  if (tagContentType.reading.type == "batched") {
                      if (!cachedBatchedItems[tagContentType.reading.fetchUrlPath]) {
                          cachedBatchedItems[tagContentType.reading.fetchUrlPath] = {
                              batcher: createBatcher(async (values) => {
                                if(tagContentType.reading.type == "single"){
                                    return
                                }
                                const processedValues = cachedBatchedItems[tagContentType.reading.fetchUrlPath].processedValues  
                                const cache = cachedBatchedItems[tagContentType.reading.fetchUrlPath].cache
                                if (values) {
                                    const filteredValues = values.filter(v=>{
                                        return !processedValues.find(cv=>cv == v)
                                    })
                                    if(filteredValues.length){
                                        const response = (await apiClient.post(tagContentType.reading.fetchUrlPath, {
                                            [tagContentType.reading.bodyKeyForValuesList]: values, 
                                        }, {
                                            now,
                                            sinceMins: 3 * 60 * 24,
                                        })).data
                                        const result = recursiveSelect(tagContentType.reading.fetchMapper || [], response);
                                        if(result && Array.isArray(result) ){
                                            for(const item of result){
                                                const foundCachedItem = cache.find(ci=>{
                                                    return tagContentType.reading.type == "batched" && recursiveSelect(tagContentType.reading.batchUniqueMatchMapper || [], item) == recursiveSelect(tagContentType.reading.batchUniqueMatchMapper || [], ci)
                                                })
                                                if(!foundCachedItem){
                                                    cache.push(item)
                                                }
                                            }
                                        }
                                    }
                                }
                              }, tagContentType.reading.fetchUrlPath),
                              cache: [],
                              processedValues: [],
                          };
                      }
                      const cachedItems = cachedBatchedItems[tagContentType.reading.fetchUrlPath];

                      if (cachedItems) {
                          const lookForValueInCache = () => {
                              const found = recursiveLookup(
                                  tagContentType.reading.valueMapper || [],
                                  contentValue,
                                  cachedItems.cache
                              );
                              if (found) {
                                  return {
                                      display: tagContentType.display,
                                      text: processTextMapper(tagContentType.reading.textMapper, found),
                                      value: found,
                                  };
                              }
                          };
                          let value:
                              | { value: any; text: string; display: string }
                              | PromiseLike<{ value: any; text: string; display: string } | null>
                              | null
                              | undefined;
                          value = lookForValueInCache();
                          if (value) {
                              return value;
                          }
                          if (!cachedItems.processedValues.find((v) => v == contentValue)) {
                              await cachedItems.batcher.set(contentValue);
                              value = lookForValueInCache();
                              if (value) {
                                  return value;
                              }
                          }
                      }
                  } else if (tagContentType.reading.type == "single") {
                      try {
                          tagContentType.reading;
                          const response = recursiveSelect(
                              tagContentType.reading.valueMapper || [],
                              await apiClient.post(
                                  tagContentType.reading.urlPath,
                                  {
                                      [tagContentType.reading.bodyKey]: contentTypeId,
                                  },
                                  {
                                      sinceMins: 3 * 60 * 24,
                                      now,
                                  }
                              )
                          );
                          if (response) {
                              return {
                                  display: tagContentType.display,
                                  value: response,
                                  text: processTextMapper(tagContentType.reading.textMapper, response),
                              };
                          }
                      } catch (error) {
                          console.log("error looking for tag value", error);
                          return null;
                      }
                  }

                  return null;
              },
        type: "deferred",
        text: `the tag of type ${tagContentType.display}, with value ${contentValue} stored on tag`,
    };
};

const getEnumTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
}: FindTagProps & {
    tagContentType: EnumContentType;
    contentTypeId: number;
    contentValue: number;
}): (TagEnumInfo & TagInfoBase) | null => {
    const foundValue = tagContentType.values.find((enumValue) => {
        return enumValue.value == contentValue;
    });
    if (!foundValue) {
        return null;
    }
    return {
        contentTypeId,
        contentValue,
        type: "enum",
        contentType: tagContentType,
        value: foundValue,
        text: foundValue.text,
    };
};

const getFetchedListTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
}: FindTagProps & {
    tagContentType: FetchedListContentType & { data?: any[] };
    contentTypeId: number;
    contentValue: number;
}): (TagFetchedListInfo & TagInfoBase) | null => {
    const found = recursiveLookup(tagContentType.valueMapper || [], contentValue, tagContentType.data);
    if (found) {
        return {
            contentType: tagContentType,
            contentTypeId,
            contentValue,
            type: "fetchedList",
            value: found,
            display: tagContentType.display,
            text: processTextMapper(tagContentType.textMapper, found),
        };
    }

    return null;
};

const getFixedTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
}: FindTagProps & {
    tagContentType: FixedContentType & { data?: any[] };
    contentTypeId: number;
    contentValue: number;
}): (TagFixedInfo & TagInfoBase) | null => {
    const text = tagContentType.textFormatter
        .replaceAll("[TagEpc]", tagEpc)
        .replaceAll("[TagContentTypeId]", contentTypeId.toString())
        .replaceAll("[TagContentValue]", contentValue.toString());
    return {
        contentType: tagContentType,
        contentTypeId,
        contentValue,
        type: "fixed",
        text,
    };
};

const getManualTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
}: FindTagProps & {
    tagContentType: ManualContentType & { data?: any[] };
    contentTypeId: number;
    contentValue: number;
}): (TagManualInfo & TagInfoBase) | null => {
    const text = tagContentType.textFormatter
        .replaceAll("[TagEpc]", tagEpc)
        .replaceAll("[TagContentTypeId]", contentTypeId.toString())
        .replaceAll("[TagContentValue]", contentValue.toString());
    return {
        contentType: tagContentType,
        contentTypeId,
        contentValue,
        type: "manual",
        text,
    };
};

export const findTagInfo = ({ tagContentTypes, tagEpc, apiClient }: FindTagProps): TagInfo | null => {
    if (!tagEpc || !tagContentTypes) {
        return null;
    }
    const numbers = getTagNumbers(tagEpc);
    if (!numbers) {
        return null;
    }
    const [contentTypeId, ContentValue] = numbers;
    const contentType = tagContentTypes.find((ct) => {
        if (ct.type == "legacy") {
            return ct.content_type_id == contentTypeId;
        } else {
            return ct.contentTypeId == contentTypeId;
        }
    });
    if (!contentType) {
        return null;
    }
    const findTagProps = {
        tagContentTypes,
        tagEpc,
        apiClient,
        tagContentType: contentType as any,
        contentTypeId: contentTypeId,
        contentValue: ContentValue,
    };
    if (contentType.type == "deferred") {
        return getDeferredTagInfo(findTagProps);
    } else if (contentType.type == "enum") {
        return getEnumTagInfo(findTagProps);
    } else if (contentType.type == "fetchedList") {
        return getFetchedListTagInfo(findTagProps);
    } else if (contentType.type == "fixed") {
        return getFixedTagInfo(findTagProps);
    } else if (contentType.type == "manual") {
        return getManualTagInfo(findTagProps);
    }

    return null;
};
