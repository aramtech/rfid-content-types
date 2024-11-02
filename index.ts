import type { ApiInterface } from "@/utils/api-client/index.js";
import AsyncLock from "async-lock";

// #region utils
const lock = new AsyncLock({ maxExecutionTime: 5e3 });
type ArgumentsType<T> = T extends (...args: infer U) => any ? U : never;

export const lockMethod = function <T extends (...args: any[]) => any>(
    method: T,
    {
        lock_name,
        lock_timeout = 1e4,
    }: {
        lock_name: string;
        lock_timeout?: number;
    },
): (...args: ArgumentsType<T>) => Promise<ReturnType<T>> {
    const originalMethod = method;
    return async function (...args: any[]) {
        return new Promise(async (resolve, reject) => {
            try {
                await lock.acquire(
                    lock_name,
                    async () => {
                        try {
                            return resolve(await originalMethod(...args));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    {
                        timeout: lock_timeout,
                    },
                );
            } catch (error) {
                reject(error);
            }
        });
    };
};

/**
 * a text mapper returns a string that represents content should be shown from given item
 * for example we have the item
 * ```ts
 * const person = {name: "John Doe", personalProperties: { age: 26 } }
 * ```
 * and i want to show it as "john doe is 26 years old yeahhhhh"  which will be as follow
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
    try {
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
                            const index = Number(indexMatch);
                            const unknownReplacement = "<unknown>";

                            if (Number.isNaN(index)) {
                                return unknownReplacement;
                            } else {
                                return matchedValues[index] || unknownReplacement;
                            }
                        },
                    );
                    processedTextList.push(formattedText);
                } else {
                    processedTextList.push(item.notMatchingString);
                }
            }
        }
    } catch (error) {
        console.log("error processing text mapper", error);
    }
    return processedTextList.join(" ");
};


export const validEpc = (epc: any) => {
    return typeof epc == "string" && epc.match(/^[0-9abcdefABCDEF]+$/) && !epc.match(/\berror\b|\s|\n/);
};

const isWeb = () => {
    try {
        // @ts-ignore
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
        return undefined;
    }
}


const removeCircular = (obj: any) => {
    if (!obj || typeof obj != 'object') {
        return obj
    }

    //set store
    const set = new WeakSet([obj]);


    // recursively detects and deletes the object references
    (function iterateObj(obj: any) {
        for (const key in obj) {
            // if the key is not present in prototye chain
            if (obj.hasOwnProperty(key)) {
                if (!!obj[key] && typeof obj[key] === 'object') {
                    // if the set has object reference
                    // then delete it
                    if (set.has(obj[key])) {
                        delete obj[key]
                    }
                    else {
                        // store the object reference
                        set.add(obj[key]);
                        // recursively iterate the next objects
                        iterateObj(obj[key]);
                    }
                }
            }
        }
    })(obj);
    return obj
}

const __recursiveLookup = (
    lookupMap: string | string[],
    lookingForValue: string | number,
    target: any,
    parent: any = undefined,
    root: number = 0,
    seen: any[] = [],
): { depth: number; result: any } => {

    if (seen.includes(target)) {
        return { depth: root, result: null };
    }
    seen.push(target)
    if (root === 0) {
        if (typeof target == "object") {
            target = structuredClone(target)
        }
    }

    if (typeof lookupMap == "string") {
        lookupMap = lookupMap.split(".");
    }

    if (target === null || target === undefined) {
        return { depth: root, result: null };
    }
    const setParent = (obj: { depth: number; result: any }) => {
        if (!obj.result) {
            return;
        }
        let lastParent = obj.result;
        for (let i = 0; i < obj.depth - root - 2; i++) {
            lastParent = lastParent?.__parent__;
        }

        if (lastParent && lastParent !== target) {
            lastParent.__parent__ = target;
        }
    };
    if (typeof target == "object") {
        if (Array.isArray(target)) {
            if (lookupMap[0] != "[]") {
                return { depth: root, result: null };
            }
            let result = null as any;
            for (const item of target) {
                const match = __recursiveLookup(lookupMap.slice(1), lookingForValue, item, target, root + 1, [...seen]);
                if (match.result) {
                    result = match;
                    break;
                }
            }
            if (result) {
                setParent(result);
                return result;
            }
        } else {
            const result = __recursiveLookup(lookupMap.slice(1), lookingForValue, target[lookupMap[0] == "[value]" ? lookingForValue : lookupMap[0]], target, root + 1, [...seen]);
            setParent(result);
            return result;
        }
    } else if (!lookupMap.length) {
        if (typeof target == "string" || typeof target == "number") {
            if (target == lookingForValue) {
                const result = parent || target
                result.toJson = () => {
                    return cyclicStringify(result)
                }
                return { depth: root, result: result };
            }
        }
    }
    return { depth: root, result: null };
};
export const recursiveLookup = (
    lookupMap: string | string[],
    lookingForValue: string | number,
    target: any,
): { depth: number; result: any } => {
    const result = __recursiveLookup(lookupMap, lookingForValue, target)
    if (typeof result.result == 'object') {
        return { depth: result.depth, result: removeCircular(result.result) }
    }
    return result
}


export const cyclicStringify = (obj: any) => {
    const seen = [] as any[];
    return JSON.stringify(obj, function (key, val) {
        if (val != null && typeof val == "object") {
            if (seen.indexOf(val) >= 0) {
                return;
            }
            seen.push(val);
        }
        return val;
    });
};
export type BatcherOptions = {
    periodInMs: number;
};
export const createBatcher = <T>(
    cb: (props?: T[]) => any,
    id: string,
    options: BatcherOptions = {
        periodInMs: 300,
    },
) => {
    let timeout = null as any;
    const batched = [] as T[];

    let lastUpdated = -Infinity;

    const callBatcher = async (props?: T[]): Promise<void> => {
        try {
            lastUpdated = Date.now();
            await cb(props);
        } catch (error: any) {
            console.log("Batch error, ID: ", id, "\nError:", String(error?.message));
        }
        callPendingCallbacks();
    };

    const pendingCallbacks = [] as (() => any)[];
    const timeoutPeriod = options.periodInMs + 7;
    const callPendingCallbacks = () => {
        pendingCallbacks.splice(0).map(async (cb) => {
            try {
                await cb();
            } catch (error) {
                console.log("failed to process cb for batcher", id, error);
            }
        });
    };

    return {
        set: lockMethod(
            (props?: T, cb?: () => any) => {
                if (props) {
                    batched.push(props);
                }
                if (cb) {
                    pendingCallbacks.push(cb);
                }
                if (timeout && Date.now() - lastUpdated >= timeoutPeriod - 14) {
                    callBatcher(batched.splice(0));
                } else {
                    clearTimeout(timeout);
                    timeout = setTimeout(async () => {
                        await callBatcher(batched.splice(0));
                    }, timeoutPeriod);
                }
            },
            {
                lock_timeout: 120e3,
                lock_name: id,
            },
        ),
        async setNow(props?: T) {
            props && batched.push(props);
            try {
                await cb(batched.splice(0));
            } catch (error: any) {
                console.log("Batch error", id, String(error?.message));
            }
        },
        clearTimeoutHandler() {
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

export type TagContentTypeWithData = { data?: any[] } & TagContentType;

type LoadTagsContentProps = {
    apiClient: ApiInterface<any, any, any, any>;
    now: boolean;
    path: string;
};

export const loadContentTypes = async (props: LoadTagsContentProps) => {
    const Api: ApiInterface<any, any, any, any> = props.apiClient;
    const tagContentTypes: TagContentTypeWithData[] = (
        await Api.post(
            props.path,
            {
                legacy: false,
            },
            {
                sinceMins: 3 * 24 * 60,
                now: props.now,
            },
        )
    ).data;
    for (const contentType of tagContentTypes) {
        if (contentType.type == "fetchedList") {
            const response = (
                await Api.post(contentType.fetchedListUrl, null, {
                    sinceMins: 3 * 24 * 60,
                    now: props.now,
                    notScoped: true,
                })
            ).data;
            const data = recursiveSelect(contentType.fetchMapper || [], response);
            contentType.data = data;
        }
    }
    return tagContentTypes;
};

export const getTagNumbers = (tagEpc: string): null | [number, number] => {
    if (tagEpc?.length >= 32) {
        tagEpc = tagEpc.slice(8);
    }
    const [v1, v2] =
        tagEpc.match(/.{1,8}/g)?.map((i) => {
            return parseInt(i, 16);
        }) || [];
    if (!v1 || !v2) {
        return null;
    }
    return [v1, v2];
};

type TagInfoBase = {
    text: string;
    contentTypeId: number;
    contentValue: number;
};

export type TagInfoType = "deferred" | "fixed" | "fetchedList" | "enum" | "manual";

export type FetchedDeferredContent = {
    value: any;
    text: string;
    display: string;
} | null

type TagDeferredInfo = {
    contentType: DeferredContentType;
    type: "deferred";
    fetch?: () => Promise<FetchedDeferredContent>;
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
export type TagInfo = TagInfoBase & TagInfoContent;
export type TagInfoWithExtraFetcher<TagExtraType = any> = TagInfo & {
    fetchExtraInfo?: (now?: boolean) => Promise<TagExtraType | null>
}
export type Merge<T, U> = T & Omit<U, keyof T>;

type FindTagProps = {
    tagEpc: string;
    now?: boolean;
    extrasFetchUrl?: string;
    extrasBodyKey?: string;
    extrasFetchMapper?: string;
    virtualEpcsFetchUrl?: string;
    virtualEpcsBodyKey?: string;
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
const processDeferredBatched = async ({
    tagContentType,
    Api,
    now,
    contentValue,
}: {
    tagContentType: DeferredContentType;
    Api: ApiInterface<any, any, any, any>;
    now: boolean;
    contentValue: number;
}): Promise<{
    value: any;
    text: string;
    display: string;
} | null> => {
    if (tagContentType.reading.type != "batched") {
        return null;
    }

    if (!cachedBatchedItems[tagContentType.reading.fetchUrlPath]) {
        cachedBatchedItems[tagContentType.reading.fetchUrlPath] = {
            batcher: createBatcher<number>(async (values) => {
                if (tagContentType.reading.type != "batched") {
                    return null;
                }
                const processedValues = cachedBatchedItems[tagContentType.reading.fetchUrlPath].processedValues;
                // const cache = cachedBatchedItems[tagContentType.reading.fetchUrlPath].cache;
                if (values) {
                    const filteredValues = [] as number[];

                    for (const v of values) {
                        if (!processedValues.find((cv) => cv == v) && !filteredValues.find((fv) => fv == v)) {
                            filteredValues.push(v);
                        }
                    }
                    if (filteredValues.length) {
                        const response = (
                            await new Promise<any>((resolve, reject) => {
                                Api.post(
                                    (tagContentType as any).reading.fetchUrlPath,
                                    {
                                        [(tagContentType as any).reading.bodyKeyForValuesList]: filteredValues,
                                    },
                                    {
                                        now,
                                        notScoped: true,
                                        sinceMins: 3 * 60 * 24,
                                    },
                                )
                                    .then(resolve)
                                    .catch(reject);
                            })
                        ).data;
                        const result = recursiveSelect(tagContentType.reading.fetchMapper || [], response);

                        const cache = cachedBatchedItems[tagContentType.reading.fetchUrlPath].cache
                        if (result && Array.isArray(result)) {
                            for (const item of result) {
                                const foundCachedItem = cache.find((ci) => {
                                    return (
                                        tagContentType.reading.type == "batched" &&
                                        recursiveSelect(tagContentType.reading.batchUniqueMatchMapper || [], item) ==
                                        recursiveSelect(tagContentType.reading.batchUniqueMatchMapper || [], ci)
                                    );
                                });
                                if (!foundCachedItem) {
                                    cache.push(item);
                                }
                            }
                        }
                    }
                    return;
                }
            }, tagContentType.reading.fetchUrlPath),
            cache: [],
            processedValues: [],
        };
    }
    const cachedItems = cachedBatchedItems[tagContentType.reading.fetchUrlPath];

    if (cachedItems) {
        const lookForValueInCache = () => {
            const { result: found } = recursiveLookup(tagContentType.reading.valueMapper || [], contentValue, cachedItems.cache);
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
            | undefined = null;
        value = lookForValueInCache();
        if (value) {
            return value;
        }
        if (!cachedItems.processedValues.find((v) => v == contentValue)) {
            return new Promise((resolve, reject) => {
                cachedItems.batcher.set(contentValue, () => {
                    value = lookForValueInCache();
                    if (value) {
                        return resolve(value);
                    }
                    return resolve(null);
                });
            });
        }
    }
    return null;
};

const getDeferredTagInfo = ({
    tagContentTypes,
    tagEpc,
    apiClient,
    tagContentType,
    contentTypeId,
    contentValue,
    now: defaultNow,
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
            : async (now: boolean = typeof defaultNow == 'boolean' ? defaultNow : !onWeb) => {
                if (!apiClient) {
                    return null;
                }
                const Api: ApiInterface<any, any, any, any> = apiClient;
                if (tagContentType.reading.type == "batched") {
                    return await processDeferredBatched({
                        Api,
                        contentValue,
                        now,
                        tagContentType,
                    });
                } else if (tagContentType.reading.type == "single") {
                    try {
                        tagContentType.reading;
                        const response = recursiveSelect(
                            tagContentType.reading.valueMapper || [],
                            await Api.post(
                                tagContentType.reading.urlPath,
                                {
                                    [tagContentType.reading.bodyKey]: contentTypeId,
                                },
                                {
                                    sinceMins: 3 * 60 * 24,
                                    now,
                                },
                            ),
                        );
                        if (response) {
                            return {
                                display: tagContentType.display,
                                value: response,
                                text: processTextMapper(tagContentType.reading.textMapper, response),
                            };
                        }
                    } catch (error) {
                        console.log("error looking for tag value", String(error));
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
    const { result: found } = recursiveLookup(tagContentType.valueMapper || [], contentValue, tagContentType.data);
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


const extrasProcessedTags = new Map<string, {
    value: any;
    epc: string;
    status: "found"
} | {
    epc: string;
    status: "not-found"
}>()
const virtuallyProcessedTags = new Map<string, {
    epc: string;
    contentId: number;
    contentValue: number;
    status: "found";
} | {
    epc: string;
    status: "not-found"
}>()

export type MaybeVirtual = {
    type: "maybeVirtual",
    fetch: (now?: boolean) => Promise<null | TagInfo>,
}

export const clearVirtualTagsCache = () => {
    virtuallyProcessedTags.clear();
}

export const clearExtrasTagsCache = () => {
    extrasProcessedTags.clear();
}
export const clearCachedBatchedItems = () => {
    for (const key in cachedBatchedItems) {
        cachedBatchedItems[key].cache = [];
        cachedBatchedItems[key].processedValues = [];
    }
}
export const clearAllCache = () => {
    clearVirtualTagsCache();
    clearCachedBatchedItems();
    clearExtrasTagsCache();
}

const getTagInfoFromValuesWithoutExtraFetcher = ({ apiClient, now, tagContentTypes, tagEpc, contentId: contentTypeId, contentValue: ContentValue }: {
    apiClient?: ApiInterface<any, any, any, any>;
    tagEpc: string;
    tagContentTypes: TagContentTypeWithData[];
    now?: boolean;
    contentId: number;
    contentValue: number;
}): null | TagInfo => {
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
        now,
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
}

const getTagInfoFromValues = <ExtrasType>({ apiClient, now, tagContentTypes, tagEpc, contentId: contentTypeId, contentValue: ContentValue }: {
    apiClient?: ApiInterface<any, any, any, any>;
    tagEpc: string;
    tagContentTypes: TagContentTypeWithData[];
    now?: boolean;
    contentId: number;
    contentValue: number;
}): null | TagInfoWithExtraFetcher<ExtrasType> => {
    const result = getTagInfoFromValuesWithoutExtraFetcher({ apiClient, now, tagContentTypes, tagEpc, contentId: contentTypeId, contentValue: ContentValue })
    if (!result) {
        return null;
    }

    return {
        ...result,
        fetchExtraInfo: apiClient && extrasLookupBatcher ? async (): Promise<ExtrasType | null> => {
            const tagExtra = extrasProcessedTags.get(tagEpc);
            if (tagExtra) {
                if (tagExtra.status == 'found') {
                    return tagExtra.value as ExtrasType
                } else {
                    return null
                }
            } else {
                await new Promise<void>(async resolve => {
                    await extrasLookupBatcher?.set(tagEpc, resolve);
                })
                const tagExtra = extrasProcessedTags.get(tagEpc);
                if (tagExtra?.status == 'found') {
                    return tagExtra.value as ExtrasType
                } else {
                    return null
                }
            }
        } : undefined
    }
}

let extrasLookupBatcher: ReturnType<typeof createBatcher<string>> | null = null;
let virtualLookupBatcher: ReturnType<typeof createBatcher<string>> | null = null;
export const findTagInfo = <ExtrasType = any>({ extrasFetchMapper, extrasBodyKey, extrasFetchUrl, tagContentTypes, now, tagEpc, apiClient, virtualEpcsBodyKey, virtualEpcsFetchUrl }: FindTagProps): TagInfoWithExtraFetcher<ExtrasType> | MaybeVirtual | null => {
    if (!tagEpc || !tagContentTypes) {
        return null;
    }
    let numbers = getTagNumbers(tagEpc);
    if (!numbers) {
        if (apiClient && extrasFetchUrl && extrasBodyKey && extrasFetchMapper && !extrasLookupBatcher) {
            extrasLookupBatcher = createBatcher(async (epcs) => {
                if (epcs?.length) {
                    const filteredEpcs = [] as string[];
                    for (const epc of epcs) {
                        if (!extrasProcessedTags.has(epc) && !filteredEpcs.find(e => epc == e)) {
                            filteredEpcs.push(epc)
                        }
                    }

                    const tagsExtras = recursiveSelect(await apiClient.post(extrasFetchUrl, {
                        [extrasBodyKey]: filteredEpcs,
                    }), extrasFetchMapper) as {
                        [epc: string]: ExtrasType
                    };
                    const notFoundEpcs = filteredEpcs.filter(epc => {
                        return !tagsExtras[epc]
                    });
                    for (const epc of notFoundEpcs) {
                        extrasProcessedTags.set(epc, {
                            status: "not-found",
                            epc
                        })
                    }
                    for (const epc in tagsExtras) {
                        extrasProcessedTags.set(epc, {
                            status: "found",
                            epc,
                            value: tagsExtras[epc]
                        })
                    }

                }
            }, "extrasLookupBatcher")
        }


        if (apiClient && virtualEpcsBodyKey && virtualEpcsFetchUrl) {
            if (!virtualLookupBatcher) {
                virtualLookupBatcher = createBatcher<string>(async (epcs) => {
                    if (epcs?.length) {
                        const filteredEpcs = [] as string[];
                        for (const epc of filteredEpcs) {
                            if (!filteredEpcs.find(e => e == epc) && !virtuallyProcessedTags.get(epc)) {
                                filteredEpcs.push(epc)
                            }
                        }

                        const results = (await apiClient.post(virtualEpcsFetchUrl, {
                            [virtualEpcsBodyKey]: filteredEpcs,
                        }, {
                            sinceMins: 3 * 24 * 60,
                            now,
                        })).data.results as {
                            [key: string]: {
                                content_value: number;
                                content_id: number;
                            }
                        };
                        const notFoundEpcs = epcs.filter(epc => !results[epc])
                        for (const epcKey in results) {
                            virtuallyProcessedTags.set(epcKey, {
                                status: "found",
                                epc: epcKey,
                                contentId: results[epcKey].content_id,
                                contentValue: results[epcKey].content_value,
                            })
                        }
                        for (const notFoundEpc of notFoundEpcs) {
                            virtuallyProcessedTags.set(notFoundEpc, {
                                status: "not-found",
                                epc: notFoundEpc,
                            })
                        }
                    }
                }, "EpcVirtualLookup")
            }

            const tagVirtualInfo = virtuallyProcessedTags.get(tagEpc);
            if (!tagVirtualInfo) {
                const defaultNow = now;
                return {
                    type: "maybeVirtual",
                    async fetch(now = typeof defaultNow == 'boolean' ? defaultNow : !onWeb) {
                        const tagVirtualInfo = virtuallyProcessedTags.get(tagEpc);
                        if (tagVirtualInfo) {
                            if (tagVirtualInfo.status == "not-found") {
                                return null
                            } else {
                                const numbers = [tagVirtualInfo.contentId, tagVirtualInfo.contentValue]
                                return getTagInfoFromValues<ExtrasType>({
                                    apiClient,
                                    contentId: numbers[0],
                                    contentValue: numbers[1],
                                    now,
                                    tagContentTypes,
                                    tagEpc,
                                })
                            }
                        } else {
                            await new Promise<void>(async resolve => {
                                await virtualLookupBatcher?.set(tagEpc, resolve);
                            })
                            const tagVirtualInfo = virtuallyProcessedTags.get(tagEpc);
                            if (!tagVirtualInfo || tagVirtualInfo?.status == "not-found") {
                                return null
                            } else {
                                const numbers = [tagVirtualInfo.contentId, tagVirtualInfo.contentValue]
                                return getTagInfoFromValues<ExtrasType>({
                                    apiClient,
                                    contentId: numbers[0],
                                    contentValue: numbers[1],
                                    now,
                                    tagContentTypes,
                                    tagEpc,
                                })
                            }
                        }
                    },
                }
            } else {
                if (tagVirtualInfo.status == "not-found") {
                    return null
                } else {
                    numbers = [tagVirtualInfo.contentId, tagVirtualInfo.contentValue]
                }
            }
        } else {
            return null
        }
    }
    return getTagInfoFromValues<ExtrasType>({
        apiClient,
        contentId: numbers[0],
        contentValue: numbers[1],
        now,
        tagContentTypes,
        tagEpc,
    })

};
