[**ReactiveBase API Reference**](../README.md)

***

[ReactiveBase API Reference](../README.md) / @reactivebase/client - Framework-agnostic client SDK

# @reactivebase/client - Framework-agnostic client SDK

## Classes

### QueryCache

Defined in: [client/src/cache/query-cache.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L21)

#### Constructors

##### new QueryCache()

> **new QueryCache**(): [`QueryCache`](client%20-%20Framework-agnostic%20client%20SDK.md#querycache)

###### Returns

[`QueryCache`](client%20-%20Framework-agnostic%20client%20SDK.md#querycache)

#### Accessors

##### pendingOptimisticUpdates

###### Get Signature

> **get** **pendingOptimisticUpdates**(): `number`

Defined in: [client/src/cache/query-cache.ts:142](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L142)

Get the number of pending optimistic layers.

###### Returns

`number`

#### Methods

##### get()

> **get**(`subscriptionId`): `undefined` \| [`CacheEntry`](client%20-%20Framework-agnostic%20client%20SDK.md#cacheentry)

Defined in: [client/src/cache/query-cache.ts:29](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L29)

Get cached data for a subscription.

###### Parameters

###### subscriptionId

`string`

###### Returns

`undefined` \| [`CacheEntry`](client%20-%20Framework-agnostic%20client%20SDK.md#cacheentry)

##### set()

> **set**(`subscriptionId`, `entry`): `void`

Defined in: [client/src/cache/query-cache.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L36)

Set cached data for a subscription.

###### Parameters

###### subscriptionId

`string`

###### entry

`Omit`\<[`CacheEntry`](client%20-%20Framework-agnostic%20client%20SDK.md#cacheentry), `"updatedAt"` \| `"isStale"`\>

###### Returns

`void`

##### update()

> **update**(`subscriptionId`, `data`, `version`): `void`

Defined in: [client/src/cache/query-cache.ts:49](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L49)

Update cached data with a server update.

###### Parameters

###### subscriptionId

`string`

###### data

`unknown`

###### version

`number`

###### Returns

`void`

##### markStale()

> **markStale**(`subscriptionId`): `void`

Defined in: [client/src/cache/query-cache.ts:67](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L67)

Mark cached data as stale (e.g., during reconnection).

###### Parameters

###### subscriptionId

`string`

###### Returns

`void`

##### markAllStale()

> **markAllStale**(): `void`

Defined in: [client/src/cache/query-cache.ts:77](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L77)

Mark all entries as stale.

###### Returns

`void`

##### remove()

> **remove**(`subscriptionId`): `void`

Defined in: [client/src/cache/query-cache.ts:86](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L86)

Remove a cache entry.

###### Parameters

###### subscriptionId

`string`

###### Returns

`void`

##### applyOptimisticUpdate()

> **applyOptimisticUpdate**(`subscriptionId`, `updater`): () => `void`

Defined in: [client/src/cache/query-cache.ts:95](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L95)

Apply an optimistic update to a subscription's cache.
Returns a rollback function to revert the change.

###### Parameters

###### subscriptionId

`string`

###### updater

(`data`) => `unknown`

###### Returns

`Function`

###### Returns

`void`

##### applyOptimisticUpdateByQuery()

> **applyOptimisticUpdateByQuery**(`queryName`, `updater`): () => `void`

Defined in: [client/src/cache/query-cache.ts:122](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L122)

Apply an optimistic update across all subscriptions matching a query name.

###### Parameters

###### queryName

`string`

###### updater

(`data`, `args`) => `unknown`

###### Returns

`Function`

###### Returns

`void`

##### listen()

> **listen**(`subscriptionId`, `callback`): () => `void`

Defined in: [client/src/cache/query-cache.ts:149](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L149)

Listen for changes to a specific subscription's cache.

###### Parameters

###### subscriptionId

`string`

###### callback

(`entry`) => `void`

###### Returns

`Function`

###### Returns

`void`

##### clear()

> **clear**(): `void`

Defined in: [client/src/cache/query-cache.ts:160](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L160)

Clear all cache data.

###### Returns

`void`

***

### ConnectionManager

Defined in: [client/src/connection/connection-manager.ts:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L28)

#### Constructors

##### new ConnectionManager()

> **new ConnectionManager**(`options`): [`ConnectionManager`](client%20-%20Framework-agnostic%20client%20SDK.md#connectionmanager)

Defined in: [client/src/connection/connection-manager.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L39)

###### Parameters

###### options

`Partial`\<[`ConnectionOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#connectionoptions)\> = `{}`

###### Returns

[`ConnectionManager`](client%20-%20Framework-agnostic%20client%20SDK.md#connectionmanager)

#### Methods

##### connect()

> **connect**(): `void`

Defined in: [client/src/connection/connection-manager.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L46)

Connect to the server.

###### Returns

`void`

##### disconnect()

> **disconnect**(): `void`

Defined in: [client/src/connection/connection-manager.ts:56](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L56)

Disconnect from the server.

###### Returns

`void`

##### send()

> **send**(`message`): `void`

Defined in: [client/src/connection/connection-manager.ts:71](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L71)

Send a message to the server.

###### Parameters

###### message

`unknown`

###### Returns

`void`

##### onMessage()

> **onMessage**(`handler`): () => `void`

Defined in: [client/src/connection/connection-manager.ts:84](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L84)

Register a handler for incoming messages.

###### Parameters

###### handler

`MessageHandler`

###### Returns

`Function`

###### Returns

`void`

##### onStatus()

> **onStatus**(`handler`): () => `void`

Defined in: [client/src/connection/connection-manager.ts:92](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L92)

Register a handler for connection status changes.

###### Parameters

###### handler

`StatusHandler`

###### Returns

`Function`

###### Returns

`void`

##### getStatus()

> **getStatus**(): [`ConnectionStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#connectionstatus)

Defined in: [client/src/connection/connection-manager.ts:97](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L97)

###### Returns

[`ConnectionStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#connectionstatus)

***

### DevToolsInstrumentation

Defined in: [client/src/devtools/devtools.ts:119](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L119)

Client-side instrumentation for the ReactiveBase DevTools browser extension.
Collects subscription, mutation, cache, and WebSocket data.

#### Constructors

##### new DevToolsInstrumentation()

> **new DevToolsInstrumentation**(`options`): [`DevToolsInstrumentation`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsinstrumentation)

Defined in: [client/src/devtools/devtools.ts:151](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L151)

###### Parameters

###### options

[`DevToolsOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsoptions) = `{}`

###### Returns

[`DevToolsInstrumentation`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsinstrumentation)

#### Methods

##### trackSubscription()

> **trackSubscription**(`id`, `info`): `void`

Defined in: [client/src/devtools/devtools.ts:157](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L157)

###### Parameters

###### id

`string`

###### info

###### queryName

`string`

###### args

`unknown`

###### Returns

`void`

##### updateSubscription()

> **updateSubscription**(`id`, `data`, `latencyMs`?): `void`

Defined in: [client/src/devtools/devtools.ts:172](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L172)

###### Parameters

###### id

`string`

###### data

`unknown`

###### latencyMs?

`number`

###### Returns

`void`

##### removeSubscription()

> **removeSubscription**(`id`): `void`

Defined in: [client/src/devtools/devtools.ts:185](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L185)

###### Parameters

###### id

`string`

###### Returns

`void`

##### getSubscriptions()

> **getSubscriptions**(): [`SubscriptionInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptioninfo)[]

Defined in: [client/src/devtools/devtools.ts:194](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L194)

###### Returns

[`SubscriptionInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptioninfo)[]

##### trackMutation()

> **trackMutation**(`id`, `info`): `void`

Defined in: [client/src/devtools/devtools.ts:200](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L200)

###### Parameters

###### id

`string`

###### info

###### name

`string`

###### args

`unknown`

###### optimistic?

`boolean`

###### Returns

`void`

##### completeMutation()

> **completeMutation**(`id`): `void`

Defined in: [client/src/devtools/devtools.ts:216](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L216)

###### Parameters

###### id

`string`

###### Returns

`void`

##### failMutation()

> **failMutation**(`id`, `error`): `void`

Defined in: [client/src/devtools/devtools.ts:226](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L226)

###### Parameters

###### id

`string`

###### error

`string`

###### Returns

`void`

##### getMutations()

> **getMutations**(): [`MutationInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationinfo)[]

Defined in: [client/src/devtools/devtools.ts:237](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L237)

###### Returns

[`MutationInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationinfo)[]

##### getMutationTimeline()

> **getMutationTimeline**(): `object`[]

Defined in: [client/src/devtools/devtools.ts:241](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L241)

###### Returns

`object`[]

##### trackCacheHit()

> **trackCacheHit**(`queryName`): `void`

Defined in: [client/src/devtools/devtools.ts:253](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L253)

###### Parameters

###### queryName

`string`

###### Returns

`void`

##### trackCacheMiss()

> **trackCacheMiss**(`queryName`): `void`

Defined in: [client/src/devtools/devtools.ts:259](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L259)

###### Parameters

###### queryName

`string`

###### Returns

`void`

##### updateCacheStats()

> **updateCacheStats**(`entries`, `sizeEstimate`): `void`

Defined in: [client/src/devtools/devtools.ts:265](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L265)

###### Parameters

###### entries

`number`

###### sizeEstimate

`number`

###### Returns

`void`

##### getCacheStats()

> **getCacheStats**(): [`CacheStats`](client%20-%20Framework-agnostic%20client%20SDK.md#cachestats)

Defined in: [client/src/devtools/devtools.ts:271](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L271)

###### Returns

[`CacheStats`](client%20-%20Framework-agnostic%20client%20SDK.md#cachestats)

##### trackWsMessageSent()

> **trackWsMessageSent**(`sizeBytes`): `void`

Defined in: [client/src/devtools/devtools.ts:277](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L277)

###### Parameters

###### sizeBytes

`number`

###### Returns

`void`

##### trackWsMessageReceived()

> **trackWsMessageReceived**(`sizeBytes`): `void`

Defined in: [client/src/devtools/devtools.ts:284](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L284)

###### Parameters

###### sizeBytes

`number`

###### Returns

`void`

##### trackWsConnected()

> **trackWsConnected**(): `void`

Defined in: [client/src/devtools/devtools.ts:291](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L291)

###### Returns

`void`

##### trackWsDisconnected()

> **trackWsDisconnected**(): `void`

Defined in: [client/src/devtools/devtools.ts:297](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L297)

###### Returns

`void`

##### getWsStats()

> **getWsStats**(): [`WebSocketStats`](client%20-%20Framework-agnostic%20client%20SDK.md#websocketstats)

Defined in: [client/src/devtools/devtools.ts:307](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L307)

###### Returns

[`WebSocketStats`](client%20-%20Framework-agnostic%20client%20SDK.md#websocketstats)

##### trackOptimisticApplied()

> **trackOptimisticApplied**(`mutationId`, `subscriptionId`): `void`

Defined in: [client/src/devtools/devtools.ts:317](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L317)

###### Parameters

###### mutationId

`string`

###### subscriptionId

`string`

###### Returns

`void`

##### trackOptimisticConfirmed()

> **trackOptimisticConfirmed**(`mutationId`): `void`

Defined in: [client/src/devtools/devtools.ts:321](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L321)

###### Parameters

###### mutationId

`string`

###### Returns

`void`

##### trackOptimisticRolledback()

> **trackOptimisticRolledback**(`mutationId`): `void`

Defined in: [client/src/devtools/devtools.ts:325](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L325)

###### Parameters

###### mutationId

`string`

###### Returns

`void`

##### onEvent()

> **onEvent**(`handler`): () => `void`

Defined in: [client/src/devtools/devtools.ts:331](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L331)

###### Parameters

###### handler

[`DevToolsEventHandler`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolseventhandler)

###### Returns

`Function`

###### Returns

`void`

##### getEvents()

> **getEvents**(`limit`?): [`DevToolsEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsevent)[]

Defined in: [client/src/devtools/devtools.ts:336](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L336)

###### Parameters

###### limit?

`number`

###### Returns

[`DevToolsEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsevent)[]

##### takeSnapshot()

> **takeSnapshot**(): [`PerformanceSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#performancesnapshot)

Defined in: [client/src/devtools/devtools.ts:342](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L342)

###### Returns

[`PerformanceSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#performancesnapshot)

##### getSnapshots()

> **getSnapshots**(): [`PerformanceSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#performancesnapshot)[]

Defined in: [client/src/devtools/devtools.ts:355](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L355)

###### Returns

[`PerformanceSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#performancesnapshot)[]

##### startPerformanceMonitoring()

> **startPerformanceMonitoring**(): `void`

Defined in: [client/src/devtools/devtools.ts:359](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L359)

###### Returns

`void`

##### stopPerformanceMonitoring()

> **stopPerformanceMonitoring**(): `void`

Defined in: [client/src/devtools/devtools.ts:364](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L364)

###### Returns

`void`

##### getSummary()

> **getSummary**(): [`DevToolsSummary`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolssummary)

Defined in: [client/src/devtools/devtools.ts:376](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L376)

Get a summary suitable for display in DevTools panel.

###### Returns

[`DevToolsSummary`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolssummary)

##### reset()

> **reset**(): `void`

Defined in: [client/src/devtools/devtools.ts:393](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L393)

Reset all tracking data.

###### Returns

`void`

##### destroy()

> **destroy**(): `void`

Defined in: [client/src/devtools/devtools.ts:423](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L423)

Destroy the instrumentation (stop monitoring, clear data).

###### Returns

`void`

***

### MultiTabCoordinator

Defined in: [client/src/multitab/multi-tab.ts:15](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L15)

#### Constructors

##### new MultiTabCoordinator()

> **new MultiTabCoordinator**(`channelName`, `channelFactory`?): [`MultiTabCoordinator`](client%20-%20Framework-agnostic%20client%20SDK.md#multitabcoordinator)

Defined in: [client/src/multitab/multi-tab.ts:23](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L23)

###### Parameters

###### channelName

`string` = `"reactivebase_tabs"`

###### channelFactory?

() => [`BroadcastChannelLike`](client%20-%20Framework-agnostic%20client%20SDK.md#broadcastchannellike)

###### Returns

[`MultiTabCoordinator`](client%20-%20Framework-agnostic%20client%20SDK.md#multitabcoordinator)

#### Accessors

##### currentRole

###### Get Signature

> **get** **currentRole**(): [`TabRole`](client%20-%20Framework-agnostic%20client%20SDK.md#tabrole)

Defined in: [client/src/multitab/multi-tab.ts:99](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L99)

###### Returns

[`TabRole`](client%20-%20Framework-agnostic%20client%20SDK.md#tabrole)

##### id

###### Get Signature

> **get** **id**(): `string`

Defined in: [client/src/multitab/multi-tab.ts:103](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L103)

###### Returns

`string`

#### Methods

##### elect()

> **elect**(): `Promise`\<[`TabRole`](client%20-%20Framework-agnostic%20client%20SDK.md#tabrole)\>

Defined in: [client/src/multitab/multi-tab.ts:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L45)

Start the coordinator and run leader election.

###### Returns

`Promise`\<[`TabRole`](client%20-%20Framework-agnostic%20client%20SDK.md#tabrole)\>

##### onUpdate()

> **onUpdate**(`handler`): () => `void`

Defined in: [client/src/multitab/multi-tab.ts:72](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L72)

Register a handler for subscription updates (used by follower tabs).

###### Parameters

###### handler

(`data`) => `void`

###### Returns

`Function`

###### Returns

`void`

##### broadcastUpdate()

> **broadcastUpdate**(`subscriptionId`, `data`, `version`): `void`

Defined in: [client/src/multitab/multi-tab.ts:80](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L80)

Broadcast a subscription update to all tabs (used by leader).

###### Parameters

###### subscriptionId

`string`

###### data

`unknown`

###### version

`number`

###### Returns

`void`

##### close()

> **close**(): `void`

Defined in: [client/src/multitab/multi-tab.ts:91](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L91)

Close the coordinator.

###### Returns

`void`

***

### BackgroundSyncManager

Defined in: [client/src/offline/background-sync.ts:75](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L75)

#### Constructors

##### new BackgroundSyncManager()

> **new BackgroundSyncManager**(`options`): [`BackgroundSyncManager`](client%20-%20Framework-agnostic%20client%20SDK.md#backgroundsyncmanager)

Defined in: [client/src/offline/background-sync.ts:95](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L95)

###### Parameters

###### options

[`BackgroundSyncOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#backgroundsyncoptions)

###### Returns

[`BackgroundSyncManager`](client%20-%20Framework-agnostic%20client%20SDK.md#backgroundsyncmanager)

#### Accessors

##### isRunning

###### Get Signature

> **get** **isRunning**(): `boolean`

Defined in: [client/src/offline/background-sync.ts:186](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L186)

###### Returns

`boolean`

#### Methods

##### start()

> **start**(): `void`

Defined in: [client/src/offline/background-sync.ts:104](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L104)

Start the background sync loop.

###### Returns

`void`

##### stop()

> **stop**(): `void`

Defined in: [client/src/offline/background-sync.ts:119](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L119)

Stop the background sync loop.

###### Returns

`void`

##### syncNow()

> **syncNow**(): `Promise`\<`null` \| [`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

Defined in: [client/src/offline/background-sync.ts:131](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L131)

Trigger an immediate sync (bypasses interval timer).

###### Returns

`Promise`\<`null` \| [`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

##### onConnectivityChange()

> **onConnectivityChange**(`isOnline`): `void`

Defined in: [client/src/offline/background-sync.ts:150](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L150)

React to network connectivity changes.

###### Parameters

###### isOnline

`boolean`

###### Returns

`void`

##### getSyncStatus()

> **getSyncStatus**(): [`BackgroundSyncStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#backgroundsyncstatus)

Defined in: [client/src/offline/background-sync.ts:174](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L174)

###### Returns

[`BackgroundSyncStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#backgroundsyncstatus)

##### getConnectivityState()

> **getConnectivityState**(): [`ConnectivityAwarePrimitive`](client%20-%20Framework-agnostic%20client%20SDK.md#connectivityawareprimitive)

Defined in: [client/src/offline/background-sync.ts:178](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L178)

###### Returns

[`ConnectivityAwarePrimitive`](client%20-%20Framework-agnostic%20client%20SDK.md#connectivityawareprimitive)

##### onSyncComplete()

> **onSyncComplete**(`callback`): () => `void`

Defined in: [client/src/offline/background-sync.ts:192](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L192)

###### Parameters

###### callback

(`result`) => `void`

###### Returns

`Function`

###### Returns

`void`

##### onConflict()

> **onConflict**(`callback`): () => `void`

Defined in: [client/src/offline/background-sync.ts:199](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L199)

###### Parameters

###### callback

(`conflicts`) => `void`

###### Returns

`Function`

###### Returns

`void`

##### enqueuePriority()

> **enqueuePriority**(`mutation`): `void`

Defined in: [client/src/offline/background-sync.ts:208](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L208)

###### Parameters

###### mutation

[`PriorityMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#prioritymutation)

###### Returns

`void`

##### getPriorityQueue()

> **getPriorityQueue**(): [`PriorityMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#prioritymutation)[]

Defined in: [client/src/offline/background-sync.ts:217](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L217)

###### Returns

[`PriorityMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#prioritymutation)[]

##### clearPriorityQueue()

> **clearPriorityQueue**(): `void`

Defined in: [client/src/offline/background-sync.ts:221](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L221)

###### Returns

`void`

***

### ConflictResolver

Defined in: [client/src/offline/conflict-resolver.ts:52](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L52)

#### Constructors

##### new ConflictResolver()

> **new ConflictResolver**(`config`): [`ConflictResolver`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictresolver)

Defined in: [client/src/offline/conflict-resolver.ts:57](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L57)

###### Parameters

###### config

[`ConflictResolutionConfig`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictresolutionconfig) = `{}`

###### Returns

[`ConflictResolver`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictresolver)

#### Methods

##### resolve()

> **resolve**(`conflict`): [`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)

Defined in: [client/src/offline/conflict-resolver.ts:68](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L68)

Resolve a conflict using the configured strategy.

###### Parameters

###### conflict

[`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)

###### Returns

[`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)

##### fieldMerge()

> **fieldMerge**(`serverVersion`, `clientVersion`, `baseVersion`?): `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:119](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L119)

3-way merge on per-field basis.
If a base version is provided, only fields changed from base are merged.
Without a base, fields from both versions are combined (client fields take
precedence for fields present in both).

###### Parameters

###### serverVersion

`Record`\<`string`, `unknown`\>

###### clientVersion

`Record`\<`string`, `unknown`\>

###### baseVersion?

`Record`\<`string`, `unknown`\>

###### Returns

`Record`\<`string`, `unknown`\>

##### detectConflicts()

> **detectConflicts**(`localChanges`, `remoteChanges`): [`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)[]

Defined in: [client/src/offline/conflict-resolver.ts:161](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L161)

Detect conflicts between local and remote change sets.
Returns only mutations that modify the same table + row.

###### Parameters

###### localChanges

`object`[]

###### remoteChanges

`object`[]

###### Returns

[`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)[]

##### getConflictLog()

> **getConflictLog**(): [`ConflictLogEntry`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictlogentry)[]

Defined in: [client/src/offline/conflict-resolver.ts:190](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L190)

Get the conflict log for debugging.

###### Returns

[`ConflictLogEntry`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictlogentry)[]

##### clearConflictLog()

> **clearConflictLog**(): `void`

Defined in: [client/src/offline/conflict-resolver.ts:197](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L197)

Clear the conflict log.

###### Returns

`void`

***

### PersistentCache

Defined in: [client/src/offline/offline.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L36)

Persistent query cache that survives page reloads.

#### Constructors

##### new PersistentCache()

> **new PersistentCache**(`storage`): [`PersistentCache`](client%20-%20Framework-agnostic%20client%20SDK.md#persistentcache)

Defined in: [client/src/offline/offline.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L39)

###### Parameters

###### storage

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

###### Returns

[`PersistentCache`](client%20-%20Framework-agnostic%20client%20SDK.md#persistentcache)

#### Methods

##### get()

> **get**(`queryName`, `argsKey`): `Promise`\<`undefined` \| [`CachedQuery`](client%20-%20Framework-agnostic%20client%20SDK.md#cachedquery)\>

Defined in: [client/src/offline/offline.ts:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L41)

###### Parameters

###### queryName

`string`

###### argsKey

`string`

###### Returns

`Promise`\<`undefined` \| [`CachedQuery`](client%20-%20Framework-agnostic%20client%20SDK.md#cachedquery)\>

##### set()

> **set**(`queryName`, `argsKey`, `data`, `version`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L46)

###### Parameters

###### queryName

`string`

###### argsKey

`string`

###### data

`unknown`

###### version

`number`

###### Returns

`Promise`\<`void`\>

##### invalidate()

> **invalidate**(`queryName`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L58)

###### Parameters

###### queryName

`string`

###### Returns

`Promise`\<`void`\>

##### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:67](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L67)

###### Returns

`Promise`\<`void`\>

***

### MutationQueue

Defined in: [client/src/offline/offline.ts:92](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L92)

Mutation queue that persists pending mutations while offline.

#### Constructors

##### new MutationQueue()

> **new MutationQueue**(`storage`, `maxSize`): [`MutationQueue`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationqueue)

Defined in: [client/src/offline/offline.ts:95](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L95)

###### Parameters

###### storage

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

###### maxSize

`number` = `1000`

###### Returns

[`MutationQueue`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationqueue)

#### Methods

##### enqueue()

> **enqueue**(`mutationName`, `args`): `Promise`\<`string`\>

Defined in: [client/src/offline/offline.ts:100](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L100)

###### Parameters

###### mutationName

`string`

###### args

`unknown`

###### Returns

`Promise`\<`string`\>

##### getPending()

> **getPending**(): `Promise`\<[`PendingMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#pendingmutation)[]\>

Defined in: [client/src/offline/offline.ts:119](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L119)

###### Returns

`Promise`\<[`PendingMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#pendingmutation)[]\>

##### markComplete()

> **markComplete**(`id`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:133](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L133)

###### Parameters

###### id

`string`

###### Returns

`Promise`\<`void`\>

##### markRetry()

> **markRetry**(`id`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:137](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L137)

###### Parameters

###### id

`string`

###### Returns

`Promise`\<`void`\>

##### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:145](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L145)

###### Returns

`Promise`\<`void`\>

##### size()

> **size**(): `Promise`\<`number`\>

Defined in: [client/src/offline/offline.ts:154](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L154)

###### Returns

`Promise`\<`number`\>

***

### SyncManager

Defined in: [client/src/offline/offline.ts:162](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L162)

Sync manager that replays queued mutations on reconnection.

#### Constructors

##### new SyncManager()

> **new SyncManager**(`queue`, `executeMutation`, `options`): [`SyncManager`](client%20-%20Framework-agnostic%20client%20SDK.md#syncmanager)

Defined in: [client/src/offline/offline.ts:167](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L167)

###### Parameters

###### queue

[`MutationQueue`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationqueue)

###### executeMutation

(`name`, `args`) => `Promise`\<`unknown`\>

###### options

###### conflictStrategy?

`string`

###### Returns

[`SyncManager`](client%20-%20Framework-agnostic%20client%20SDK.md#syncmanager)

#### Accessors

##### isSyncing

###### Get Signature

> **get** **isSyncing**(): `boolean`

Defined in: [client/src/offline/offline.ts:213](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L213)

###### Returns

`boolean`

#### Methods

##### sync()

> **sync**(): `Promise`\<[`SyncResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncresult)\>

Defined in: [client/src/offline/offline.ts:179](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L179)

Replay all queued mutations in order.

###### Returns

`Promise`\<[`SyncResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncresult)\>

***

### MemoryOfflineStorage

Defined in: [client/src/offline/offline.ts:227](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L227)

In-memory storage for testing.

#### Implements

- [`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

#### Constructors

##### new MemoryOfflineStorage()

> **new MemoryOfflineStorage**(): [`MemoryOfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#memoryofflinestorage)

###### Returns

[`MemoryOfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#memoryofflinestorage)

#### Methods

##### get()

> **get**(`key`): `Promise`\<`unknown`\>

Defined in: [client/src/offline/offline.ts:230](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L230)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`get`](client%20-%20Framework-agnostic%20client%20SDK.md#get-4)

##### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:233](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L233)

###### Parameters

###### key

`string`

###### value

`unknown`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`set`](client%20-%20Framework-agnostic%20client%20SDK.md#set-4)

##### delete()

> **delete**(`key`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:236](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L236)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`delete`](client%20-%20Framework-agnostic%20client%20SDK.md#delete-2)

##### keys()

> **keys**(): `Promise`\<`string`[]\>

Defined in: [client/src/offline/offline.ts:239](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L239)

###### Returns

`Promise`\<`string`[]\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`keys`](client%20-%20Framework-agnostic%20client%20SDK.md#keys-2)

##### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:242](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L242)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`clear`](client%20-%20Framework-agnostic%20client%20SDK.md#clear-6)

***

### SQLiteCacheAdapter

Defined in: [client/src/offline/sqlite-cache.ts:83](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L83)

Offline-first client support for ReactiveBase.
Provides persistent query cache, mutation queue, and sync protocol.

Uses a pluggable storage interface (IndexedDB, localStorage, or in-memory).

#### Implements

- [`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

#### Constructors

##### new SQLiteCacheAdapter()

> **new SQLiteCacheAdapter**(`options`): [`SQLiteCacheAdapter`](client%20-%20Framework-agnostic%20client%20SDK.md#sqlitecacheadapter)

Defined in: [client/src/offline/sqlite-cache.ts:90](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L90)

###### Parameters

###### options

[`SQLiteCacheOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#sqlitecacheoptions)

###### Returns

[`SQLiteCacheAdapter`](client%20-%20Framework-agnostic%20client%20SDK.md#sqlitecacheadapter)

#### Methods

##### get()

> **get**(`key`): `Promise`\<`unknown`\>

Defined in: [client/src/offline/sqlite-cache.ts:99](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L99)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`get`](client%20-%20Framework-agnostic%20client%20SDK.md#get-4)

##### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Defined in: [client/src/offline/sqlite-cache.ts:113](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L113)

###### Parameters

###### key

`string`

###### value

`unknown`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`set`](client%20-%20Framework-agnostic%20client%20SDK.md#set-4)

##### delete()

> **delete**(`key`): `Promise`\<`void`\>

Defined in: [client/src/offline/sqlite-cache.ts:129](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L129)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`delete`](client%20-%20Framework-agnostic%20client%20SDK.md#delete-2)

##### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [client/src/offline/sqlite-cache.ts:134](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L134)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`clear`](client%20-%20Framework-agnostic%20client%20SDK.md#clear-6)

##### keys()

> **keys**(): `Promise`\<`string`[]\>

Defined in: [client/src/offline/sqlite-cache.ts:139](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L139)

###### Returns

`Promise`\<`string`[]\>

###### Implementation of

[`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage).[`keys`](client%20-%20Framework-agnostic%20client%20SDK.md#keys-2)

##### getMany()

> **getMany**(`keys`): `Promise`\<`Map`\<`string`, `unknown`\>\>

Defined in: [client/src/offline/sqlite-cache.ts:148](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L148)

###### Parameters

###### keys

`string`[]

###### Returns

`Promise`\<`Map`\<`string`, `unknown`\>\>

##### setMany()

> **setMany**(`entries`): `Promise`\<`void`\>

Defined in: [client/src/offline/sqlite-cache.ts:170](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L170)

###### Parameters

###### entries

`object`[]

###### Returns

`Promise`\<`void`\>

##### getMetadata()

> **getMetadata**(): `Promise`\<[`CacheMetadata`](client%20-%20Framework-agnostic%20client%20SDK.md#cachemetadata)\>

Defined in: [client/src/offline/sqlite-cache.ts:190](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L190)

###### Returns

`Promise`\<[`CacheMetadata`](client%20-%20Framework-agnostic%20client%20SDK.md#cachemetadata)\>

***

### OfflineSyncEngine

Defined in: [client/src/offline/sync-engine.ts:148](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L148)

#### Constructors

##### new OfflineSyncEngine()

> **new OfflineSyncEngine**(`options`): [`OfflineSyncEngine`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinesyncengine)

Defined in: [client/src/offline/sync-engine.ts:164](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L164)

###### Parameters

###### options

[`SyncEngineOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#syncengineoptions)

###### Returns

[`OfflineSyncEngine`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinesyncengine)

#### Accessors

##### syncStatus

###### Get Signature

> **get** **syncStatus**(): [`SyncStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#syncstatus-1)

Defined in: [client/src/offline/sync-engine.ts:171](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L171)

###### Returns

[`SyncStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#syncstatus-1)

##### vectorClock

###### Get Signature

> **get** **vectorClock**(): [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:175](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L175)

###### Returns

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### clientId

###### Get Signature

> **get** **clientId**(): `string`

Defined in: [client/src/offline/sync-engine.ts:179](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L179)

###### Returns

`string`

#### Methods

##### queueMutation()

> **queueMutation**(`mutationName`, `args`): `Promise`\<`string`\>

Defined in: [client/src/offline/sync-engine.ts:185](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L185)

###### Parameters

###### mutationName

`string`

###### args

`unknown`

###### Returns

`Promise`\<`string`\>

##### getPendingMutations()

> **getPendingMutations**(): `Promise`\<[`PendingMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#pendingmutation)[]\>

Defined in: [client/src/offline/sync-engine.ts:193](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L193)

###### Returns

`Promise`\<[`PendingMutation`](client%20-%20Framework-agnostic%20client%20SDK.md#pendingmutation)[]\>

##### getPendingCount()

> **getPendingCount**(): `Promise`\<`number`\>

Defined in: [client/src/offline/sync-engine.ts:197](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L197)

###### Returns

`Promise`\<`number`\>

##### cacheQuery()

> **cacheQuery**(`queryName`, `argsKey`, `data`, `version`): `Promise`\<`void`\>

Defined in: [client/src/offline/sync-engine.ts:203](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L203)

###### Parameters

###### queryName

`string`

###### argsKey

`string`

###### data

`unknown`

###### version

`number`

###### Returns

`Promise`\<`void`\>

##### getCachedQuery()

> **getCachedQuery**(`queryName`, `argsKey`): `Promise`\<`undefined` \| [`CachedQuery`](client%20-%20Framework-agnostic%20client%20SDK.md#cachedquery)\>

Defined in: [client/src/offline/sync-engine.ts:207](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L207)

###### Parameters

###### queryName

`string`

###### argsKey

`string`

###### Returns

`Promise`\<`undefined` \| [`CachedQuery`](client%20-%20Framework-agnostic%20client%20SDK.md#cachedquery)\>

##### invalidateCache()

> **invalidateCache**(`queryName`): `Promise`\<`void`\>

Defined in: [client/src/offline/sync-engine.ts:211](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L211)

###### Parameters

###### queryName

`string`

###### Returns

`Promise`\<`void`\>

##### trackDelta()

> **trackDelta**(`table`, `rowId`, `fields`): `void`

Defined in: [client/src/offline/sync-engine.ts:217](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L217)

###### Parameters

###### table

`string`

###### rowId

`string`

###### fields

`Record`\<`string`, `unknown`\>

###### Returns

`void`

##### getPendingDeltas()

> **getPendingDeltas**(): [`DeltaChange`](client%20-%20Framework-agnostic%20client%20SDK.md#deltachange)[]

Defined in: [client/src/offline/sync-engine.ts:239](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L239)

###### Returns

[`DeltaChange`](client%20-%20Framework-agnostic%20client%20SDK.md#deltachange)[]

##### clearDeltas()

> **clearDeltas**(): `void`

Defined in: [client/src/offline/sync-engine.ts:243](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L243)

###### Returns

`void`

##### sync()

> **sync**(`executeMutation`, `serverStateFetcher`?): `Promise`\<[`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

Defined in: [client/src/offline/sync-engine.ts:249](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L249)

###### Parameters

###### executeMutation

(`name`, `args`) => `Promise`\<`unknown`\>

###### serverStateFetcher?

(`mutationName`) => `Promise`\<`unknown`\>

###### Returns

`Promise`\<[`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

##### getBackoffDelay()

> **getBackoffDelay**(): `number`

Defined in: [client/src/offline/sync-engine.ts:334](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L334)

###### Returns

`number`

##### resolveVersionConflict()

> **resolveVersionConflict**(`clientValue`, `serverValue`): `object`

Defined in: [client/src/offline/sync-engine.ts:341](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L341)

###### Parameters

###### clientValue

[`VersionedValue`](client%20-%20Framework-agnostic%20client%20SDK.md#versionedvalue)

###### serverValue

[`VersionedValue`](client%20-%20Framework-agnostic%20client%20SDK.md#versionedvalue)

###### Returns

`object`

###### winner

> **winner**: `"merged"` \| `"client"` \| `"server"`

###### value

> **value**: `unknown`

##### receiveClock()

> **receiveClock**(`remoteClock`): `void`

Defined in: [client/src/offline/sync-engine.ts:383](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L383)

###### Parameters

###### remoteClock

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

###### Returns

`void`

***

### OptimisticUpdateManager

Defined in: [client/src/optimistic/optimistic.ts:91](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L91)

Manages optimistic updates with snapshot-based rollback.
Maintains a stack of snapshots so mutations can be undone in any order.

#### Constructors

##### new OptimisticUpdateManager()

> **new OptimisticUpdateManager**(`cache`, `options`): [`OptimisticUpdateManager`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticupdatemanager)

Defined in: [client/src/optimistic/optimistic.ts:99](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L99)

###### Parameters

###### cache

[`OptimisticCacheAdapter`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticcacheadapter)

###### options

[`OptimisticManagerOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticmanageroptions) = `{}`

###### Returns

[`OptimisticUpdateManager`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticupdatemanager)

#### Methods

##### apply()

> **apply**(`update`): [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

Defined in: [client/src/optimistic/optimistic.ts:108](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L108)

Apply an optimistic update. Snapshots the current data and immediately
updates the cache with the optimistic value.

###### Parameters

###### update

`Omit`\<[`OptimisticUpdate`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticupdate), `"timestamp"`\>

###### Returns

[`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

##### confirm()

> **confirm**(`mutationId`, `serverData`?): `void`

Defined in: [client/src/optimistic/optimistic.ts:146](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L146)

Confirm a mutation succeeded on the server.
Replaces optimistic data with authoritative server data.

###### Parameters

###### mutationId

`string`

###### serverData?

`unknown`

###### Returns

`void`

##### rollback()

> **rollback**(`mutationId`): `undefined` \| [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

Defined in: [client/src/optimistic/optimistic.ts:164](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L164)

Rollback a mutation. Restores the cache to the pre-mutation state.

###### Parameters

###### mutationId

`string`

###### Returns

`undefined` \| [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

##### rollbackAll()

> **rollbackAll**(): [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)[]

Defined in: [client/src/optimistic/optimistic.ts:184](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L184)

Rollback all pending optimistic updates.

###### Returns

[`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)[]

##### resolveConflict()

> **resolveConflict**(`mutationId`, `serverData`): `Promise`\<`unknown`\>

Defined in: [client/src/optimistic/optimistic.ts:198](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L198)

Handle a server conflict by invoking the conflict resolver.

###### Parameters

###### mutationId

`string`

###### serverData

`unknown`

###### Returns

`Promise`\<`unknown`\>

##### setConflictResolver()

> **setConflictResolver**(`resolver`): `void`

Defined in: [client/src/optimistic/optimistic.ts:224](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L224)

Set a custom conflict resolver.

###### Parameters

###### resolver

[`OptimisticConflictResolver`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticconflictresolver)

###### Returns

`void`

##### getSnapshot()

> **getSnapshot**(`mutationId`): `undefined` \| [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

Defined in: [client/src/optimistic/optimistic.ts:231](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L231)

Get a snapshot by mutation ID.

###### Parameters

###### mutationId

`string`

###### Returns

`undefined` \| [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

##### getPending()

> **getPending**(): [`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)[]

Defined in: [client/src/optimistic/optimistic.ts:238](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L238)

Get all pending (unconfirmed) snapshots.

###### Returns

[`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)[]

##### getPendingCount()

> **getPendingCount**(`subscriptionId`?): `number`

Defined in: [client/src/optimistic/optimistic.ts:245](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L245)

Get pending count for a specific subscription.

###### Parameters

###### subscriptionId?

`string`

###### Returns

`number`

##### hasPending()

> **hasPending**(`subscriptionId`): `boolean`

Defined in: [client/src/optimistic/optimistic.ts:254](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L254)

Check if a subscription has any pending optimistic updates.

###### Parameters

###### subscriptionId

`string`

###### Returns

`boolean`

##### clear()

> **clear**(): `void`

Defined in: [client/src/optimistic/optimistic.ts:261](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L261)

Clear all snapshots and timeouts.

###### Returns

`void`

***

### ClientMiddlewarePipeline

Defined in: [client/src/subscription/client-middleware.ts:76](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L76)

#### Constructors

##### new ClientMiddlewarePipeline()

> **new ClientMiddlewarePipeline**(): [`ClientMiddlewarePipeline`](client%20-%20Framework-agnostic%20client%20SDK.md#clientmiddlewarepipeline)

###### Returns

[`ClientMiddlewarePipeline`](client%20-%20Framework-agnostic%20client%20SDK.md#clientmiddlewarepipeline)

#### Accessors

##### count

###### Get Signature

> **get** **count**(): `number`

Defined in: [client/src/subscription/client-middleware.ts:196](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L196)

###### Returns

`number`

#### Methods

##### use()

> **use**(`middleware`): `void`

Defined in: [client/src/subscription/client-middleware.ts:82](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L82)

Add a middleware to the pipeline.

###### Parameters

###### middleware

[`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

###### Returns

`void`

##### remove()

> **remove**(`name`): `boolean`

Defined in: [client/src/subscription/client-middleware.ts:87](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L87)

Remove a middleware by name.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### runOnSubscribe()

> **runOnSubscribe**(`event`): `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:97](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L97)

Run onSubscribe hooks.

###### Parameters

###### event

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

###### Returns

`Promise`\<`void`\>

##### runOnUpdate()

> **runOnUpdate**(`event`): `Promise`\<`unknown`\>

Defined in: [client/src/subscription/client-middleware.ts:111](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L111)

Run onUpdate hooks. Data can be transformed by each middleware.

###### Parameters

###### event

[`SubscriptionUpdateEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionupdateevent)

###### Returns

`Promise`\<`unknown`\>

##### runOnError()

> **runOnError**(`event`): `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:132](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L132)

Run onError hooks.

###### Parameters

###### event

[`SubscriptionErrorEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionerrorevent)

###### Returns

`Promise`\<`void`\>

##### runOnStale()

> **runOnStale**(`event`): `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:148](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L148)

Run onStale hooks for a subscription.

###### Parameters

###### event

[`SubscriptionStaleEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionstaleevent)

###### Returns

`Promise`\<`void`\>

##### runOnReconnect()

> **runOnReconnect**(`event`): `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:161](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L161)

Run onReconnect hooks.

###### Parameters

###### event

[`SubscriptionReconnectEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionreconnectevent)

###### Returns

`Promise`\<`void`\>

##### runOnUnsubscribe()

> **runOnUnsubscribe**(`event`): `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:174](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L174)

Run onUnsubscribe hooks.

###### Parameters

###### event

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

###### Returns

`Promise`\<`void`\>

##### getStaleness()

> **getStaleness**(`subscriptionId`): `null` \| `number`

Defined in: [client/src/subscription/client-middleware.ts:190](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L190)

Get the staleness of a subscription in ms.

###### Parameters

###### subscriptionId

`string`

###### Returns

`null` \| `number`

***

### ReactiveBaseClient

Defined in: [client/src/subscription/subscription-manager.ts:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L26)

ReactiveBase client - the main entry point for client-side reactive queries.

#### Constructors

##### new ReactiveBaseClient()

> **new ReactiveBaseClient**(`options`): [`ReactiveBaseClient`](client%20-%20Framework-agnostic%20client%20SDK.md#reactivebaseclient)

Defined in: [client/src/subscription/subscription-manager.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L40)

###### Parameters

###### options

[`ReactiveBaseClientOptions`](client%20-%20Framework-agnostic%20client%20SDK.md#reactivebaseclientoptions)

###### Returns

[`ReactiveBaseClient`](client%20-%20Framework-agnostic%20client%20SDK.md#reactivebaseclient)

#### Methods

##### subscribe()

> **subscribe**(`queryName`, `args`, `listener`): () => `void`

Defined in: [client/src/subscription/subscription-manager.ts:61](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L61)

Subscribe to a reactive query.

###### Parameters

###### queryName

`string`

###### args

`unknown`

###### listener

[`QueryListener`](client%20-%20Framework-agnostic%20client%20SDK.md#querylistener)

###### Returns

`Function`

###### Returns

`void`

##### mutate()

> **mutate**(`mutationName`, `args`): `Promise`\<`unknown`\>

Defined in: [client/src/subscription/subscription-manager.ts:98](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L98)

Execute a mutation.

###### Parameters

###### mutationName

`string`

###### args

`unknown`

###### Returns

`Promise`\<`unknown`\>

##### runAction()

> **runAction**(`actionName`, `args`): `Promise`\<`unknown`\>

Defined in: [client/src/subscription/subscription-manager.ts:116](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L116)

Execute an action.

###### Parameters

###### actionName

`string`

###### args

`unknown`

###### Returns

`Promise`\<`unknown`\>

##### fetchQuery()

> **fetchQuery**(`queryName`, `args`): `Promise`\<`unknown`\>

Defined in: [client/src/subscription/subscription-manager.ts:134](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L134)

Execute a one-shot (non-reactive) query.

###### Parameters

###### queryName

`string`

###### args

`unknown`

###### Returns

`Promise`\<`unknown`\>

##### getCache()

> **getCache**(): [`QueryCache`](client%20-%20Framework-agnostic%20client%20SDK.md#querycache)

Defined in: [client/src/subscription/subscription-manager.ts:148](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L148)

Get the cache for optimistic updates.

###### Returns

[`QueryCache`](client%20-%20Framework-agnostic%20client%20SDK.md#querycache)

##### disconnect()

> **disconnect**(): `void`

Defined in: [client/src/subscription/subscription-manager.ts:155](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L155)

Disconnect from the server.

###### Returns

`void`

## Interfaces

### CacheEntry

Defined in: [client/src/cache/query-cache.ts:6](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L6)

Local query cache for storing subscription results on the client.
Supports optimistic updates with versioned rollback.

#### Properties

##### queryName

> **queryName**: `string`

Defined in: [client/src/cache/query-cache.ts:7](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L7)

##### args

> **args**: `unknown`

Defined in: [client/src/cache/query-cache.ts:8](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L8)

##### data

> **data**: `unknown`

Defined in: [client/src/cache/query-cache.ts:9](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L9)

##### version

> **version**: `number`

Defined in: [client/src/cache/query-cache.ts:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L10)

##### updatedAt

> **updatedAt**: `number`

Defined in: [client/src/cache/query-cache.ts:11](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L11)

##### isStale

> **isStale**: `boolean`

Defined in: [client/src/cache/query-cache.ts:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/cache/query-cache.ts#L12)

***

### ConnectionOptions

Defined in: [client/src/connection/connection-manager.ts:8](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L8)

#### Properties

##### url

> **url**: `string`

Defined in: [client/src/connection/connection-manager.ts:9](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L9)

##### token?

> `optional` **token**: `string`

Defined in: [client/src/connection/connection-manager.ts:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L10)

##### maxReconnectAttempts

> **maxReconnectAttempts**: `number`

Defined in: [client/src/connection/connection-manager.ts:11](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L11)

##### reconnectBaseDelay

> **reconnectBaseDelay**: `number`

Defined in: [client/src/connection/connection-manager.ts:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L12)

##### reconnectMaxDelay

> **reconnectMaxDelay**: `number`

Defined in: [client/src/connection/connection-manager.ts:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L13)

##### heartbeatInterval

> **heartbeatInterval**: `number`

Defined in: [client/src/connection/connection-manager.ts:14](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L14)

***

### DevToolsEvent

Defined in: [client/src/devtools/devtools.ts:15](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L15)

DevTools Instrumentation for ReactiveBase Client.
Provides hooks and data collection for the browser DevTools extension.
Tracks subscriptions, mutations, cache state, and WebSocket activity.

Usage:
  const devtools = new DevToolsInstrumentation()
  devtools.trackSubscription("sub_1", { queryName: "tasks.list", args: {} })
  devtools.trackMutation("m_1", { name: "tasks.complete", args: { id: "1" } })
  devtools.onEvent((event) => postMessageToExtension(event))

#### Properties

##### type

> **type**: [`DevToolsEventType`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolseventtype)

Defined in: [client/src/devtools/devtools.ts:16](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L16)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/devtools/devtools.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L17)

##### data

> **data**: `unknown`

Defined in: [client/src/devtools/devtools.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L18)

***

### SubscriptionInfo

Defined in: [client/src/devtools/devtools.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L39)

#### Properties

##### id

> **id**: `string`

Defined in: [client/src/devtools/devtools.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L40)

##### queryName

> **queryName**: `string`

Defined in: [client/src/devtools/devtools.ts:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L41)

##### args

> **args**: `unknown`

Defined in: [client/src/devtools/devtools.ts:42](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L42)

##### status

> **status**: `"error"` \| `"active"` \| `"pending"` \| `"closed"`

Defined in: [client/src/devtools/devtools.ts:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L43)

##### createdAt

> **createdAt**: `number`

Defined in: [client/src/devtools/devtools.ts:44](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L44)

##### lastUpdatedAt

> **lastUpdatedAt**: `number`

Defined in: [client/src/devtools/devtools.ts:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L45)

##### updateCount

> **updateCount**: `number`

Defined in: [client/src/devtools/devtools.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L46)

##### lastData

> **lastData**: `unknown`

Defined in: [client/src/devtools/devtools.ts:47](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L47)

##### latencyMs?

> `optional` **latencyMs**: `number`

Defined in: [client/src/devtools/devtools.ts:48](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L48)

***

### MutationInfo

Defined in: [client/src/devtools/devtools.ts:51](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L51)

#### Properties

##### id

> **id**: `string`

Defined in: [client/src/devtools/devtools.ts:52](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L52)

##### name

> **name**: `string`

Defined in: [client/src/devtools/devtools.ts:53](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L53)

##### args

> **args**: `unknown`

Defined in: [client/src/devtools/devtools.ts:54](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L54)

##### status

> **status**: `"failed"` \| `"pending"` \| `"completed"`

Defined in: [client/src/devtools/devtools.ts:55](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L55)

##### startedAt

> **startedAt**: `number`

Defined in: [client/src/devtools/devtools.ts:56](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L56)

##### completedAt?

> `optional` **completedAt**: `number`

Defined in: [client/src/devtools/devtools.ts:57](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L57)

##### durationMs?

> `optional` **durationMs**: `number`

Defined in: [client/src/devtools/devtools.ts:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L58)

##### error?

> `optional` **error**: `string`

Defined in: [client/src/devtools/devtools.ts:59](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L59)

##### optimistic

> **optimistic**: `boolean`

Defined in: [client/src/devtools/devtools.ts:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L60)

***

### CacheStats

Defined in: [client/src/devtools/devtools.ts:63](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L63)

#### Properties

##### entries

> **entries**: `number`

Defined in: [client/src/devtools/devtools.ts:64](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L64)

##### hitCount

> **hitCount**: `number`

Defined in: [client/src/devtools/devtools.ts:65](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L65)

##### missCount

> **missCount**: `number`

Defined in: [client/src/devtools/devtools.ts:66](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L66)

##### hitRate

> **hitRate**: `number`

Defined in: [client/src/devtools/devtools.ts:67](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L67)

##### totalSizeEstimate

> **totalSizeEstimate**: `number`

Defined in: [client/src/devtools/devtools.ts:68](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L68)

##### oldestEntry

> **oldestEntry**: `null` \| `number`

Defined in: [client/src/devtools/devtools.ts:69](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L69)

##### newestEntry

> **newestEntry**: `null` \| `number`

Defined in: [client/src/devtools/devtools.ts:70](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L70)

***

### WebSocketStats

Defined in: [client/src/devtools/devtools.ts:73](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L73)

#### Properties

##### messagesSent

> **messagesSent**: `number`

Defined in: [client/src/devtools/devtools.ts:74](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L74)

##### messagesReceived

> **messagesReceived**: `number`

Defined in: [client/src/devtools/devtools.ts:75](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L75)

##### bytesSent

> **bytesSent**: `number`

Defined in: [client/src/devtools/devtools.ts:76](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L76)

##### bytesReceived

> **bytesReceived**: `number`

Defined in: [client/src/devtools/devtools.ts:77](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L77)

##### connectionUptime

> **connectionUptime**: `number`

Defined in: [client/src/devtools/devtools.ts:78](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L78)

##### reconnectCount

> **reconnectCount**: `number`

Defined in: [client/src/devtools/devtools.ts:79](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L79)

##### lastMessageAt

> **lastMessageAt**: `null` \| `number`

Defined in: [client/src/devtools/devtools.ts:80](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L80)

##### status

> **status**: `"connected"` \| `"disconnected"` \| `"connecting"`

Defined in: [client/src/devtools/devtools.ts:81](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L81)

***

### PerformanceSnapshot

Defined in: [client/src/devtools/devtools.ts:84](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L84)

#### Properties

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/devtools/devtools.ts:85](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L85)

##### subscriptions

> **subscriptions**: [`SubscriptionInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptioninfo)[]

Defined in: [client/src/devtools/devtools.ts:86](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L86)

##### mutations

> **mutations**: [`MutationInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#mutationinfo)[]

Defined in: [client/src/devtools/devtools.ts:87](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L87)

##### cache

> **cache**: [`CacheStats`](client%20-%20Framework-agnostic%20client%20SDK.md#cachestats)

Defined in: [client/src/devtools/devtools.ts:88](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L88)

##### websocket

> **websocket**: [`WebSocketStats`](client%20-%20Framework-agnostic%20client%20SDK.md#websocketstats)

Defined in: [client/src/devtools/devtools.ts:89](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L89)

##### memoryUsage?

> `optional` **memoryUsage**: `number`

Defined in: [client/src/devtools/devtools.ts:90](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L90)

***

### DevToolsOptions

Defined in: [client/src/devtools/devtools.ts:97](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L97)

#### Properties

##### maxEvents?

> `optional` **maxEvents**: `number`

Defined in: [client/src/devtools/devtools.ts:99](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L99)

Max events to keep in history (default: 500)

##### maxMutations?

> `optional` **maxMutations**: `number`

Defined in: [client/src/devtools/devtools.ts:101](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L101)

Max mutations to keep in timeline (default: 200)

##### enablePerformance?

> `optional` **enablePerformance**: `boolean`

Defined in: [client/src/devtools/devtools.ts:103](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L103)

Enable performance sampling (default: true)

##### snapshotIntervalMs?

> `optional` **snapshotIntervalMs**: `number`

Defined in: [client/src/devtools/devtools.ts:105](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L105)

Performance snapshot interval in ms (default: 5000)

***

### DevToolsSummary

Defined in: [client/src/devtools/devtools.ts:450](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L450)

#### Properties

##### activeSubscriptions

> **activeSubscriptions**: `number`

Defined in: [client/src/devtools/devtools.ts:451](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L451)

##### pendingMutations

> **pendingMutations**: `number`

Defined in: [client/src/devtools/devtools.ts:452](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L452)

##### completedMutations

> **completedMutations**: `number`

Defined in: [client/src/devtools/devtools.ts:453](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L453)

##### failedMutations

> **failedMutations**: `number`

Defined in: [client/src/devtools/devtools.ts:454](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L454)

##### cacheHitRate

> **cacheHitRate**: `number`

Defined in: [client/src/devtools/devtools.ts:455](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L455)

##### cacheEntries

> **cacheEntries**: `number`

Defined in: [client/src/devtools/devtools.ts:456](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L456)

##### wsStatus

> **wsStatus**: `string`

Defined in: [client/src/devtools/devtools.ts:457](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L457)

##### wsMessageCount

> **wsMessageCount**: `number`

Defined in: [client/src/devtools/devtools.ts:458](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L458)

##### eventCount

> **eventCount**: `number`

Defined in: [client/src/devtools/devtools.ts:459](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L459)

***

### TabMessage

Defined in: [client/src/multitab/multi-tab.ts:7](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L7)

Multi-tab subscription deduplication via BroadcastChannel.
Elects a "leader" tab that owns the WebSocket connection.
Other tabs send subscribe/mutate requests through the leader.

#### Properties

##### type

> **type**: `"update"` \| `"subscribe"` \| `"unsubscribe"` \| `"leader_claim"` \| `"leader_ack"` \| `"ping"`

Defined in: [client/src/multitab/multi-tab.ts:8](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L8)

##### tabId

> **tabId**: `string`

Defined in: [client/src/multitab/multi-tab.ts:9](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L9)

##### payload?

> `optional` **payload**: `unknown`

Defined in: [client/src/multitab/multi-tab.ts:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L10)

***

### BroadcastChannelLike

Defined in: [client/src/multitab/multi-tab.ts:147](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L147)

Minimal BroadcastChannel interface for loose coupling.

#### Properties

##### onmessage

> **onmessage**: `null` \| (`event`) => `void`

Defined in: [client/src/multitab/multi-tab.ts:149](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L149)

#### Methods

##### postMessage()

> **postMessage**(`message`): `void`

Defined in: [client/src/multitab/multi-tab.ts:148](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L148)

###### Parameters

###### message

`unknown`

###### Returns

`void`

***

### BackgroundSyncStatus

Defined in: [client/src/offline/background-sync.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L21)

#### Properties

##### state

> **state**: [`SyncState`](client%20-%20Framework-agnostic%20client%20SDK.md#syncstate)

Defined in: [client/src/offline/background-sync.ts:23](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L23)

Current state of the sync engine

##### pendingCount

> **pendingCount**: `number`

Defined in: [client/src/offline/background-sync.ts:25](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L25)

Number of pending mutations waiting to sync

##### lastSyncAt

> **lastSyncAt**: `null` \| `number`

Defined in: [client/src/offline/background-sync.ts:27](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L27)

Timestamp of last successful sync (ms since epoch), or null

##### nextSyncAt

> **nextSyncAt**: `null` \| `number`

Defined in: [client/src/offline/background-sync.ts:29](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L29)

Timestamp of next scheduled sync (ms since epoch), or null

##### consecutiveFailures

> **consecutiveFailures**: `number`

Defined in: [client/src/offline/background-sync.ts:31](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L31)

Number of consecutive failures

***

### ConnectivityAwarePrimitive

Defined in: [client/src/offline/background-sync.ts:34](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L34)

#### Properties

##### isOnline

> **isOnline**: `boolean`

Defined in: [client/src/offline/background-sync.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L36)

Whether the device is currently online

##### pendingChangesCount

> **pendingChangesCount**: `number`

Defined in: [client/src/offline/background-sync.ts:38](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L38)

Number of changes waiting to be synced

##### syncProgress

> **syncProgress**: `null` \| `number`

Defined in: [client/src/offline/background-sync.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L40)

Sync progress (0-1), or null if not syncing

***

### BackgroundSyncOptions

Defined in: [client/src/offline/background-sync.ts:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L43)

#### Properties

##### syncFn()

> **syncFn**: () => `Promise`\<[`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

Defined in: [client/src/offline/background-sync.ts:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L45)

Function that performs the actual sync

###### Returns

`Promise`\<[`SyncBatchResult`](client%20-%20Framework-agnostic%20client%20SDK.md#syncbatchresult)\>

##### getPendingCount()

> **getPendingCount**: () => `Promise`\<`number`\>

Defined in: [client/src/offline/background-sync.ts:47](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L47)

Function that returns the current pending mutation count

###### Returns

`Promise`\<`number`\>

##### syncIntervalMs?

> `optional` **syncIntervalMs**: `number`

Defined in: [client/src/offline/background-sync.ts:49](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L49)

Base interval between syncs in ms (default: 5000)

##### initialBackoffMs?

> `optional` **initialBackoffMs**: `number`

Defined in: [client/src/offline/background-sync.ts:51](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L51)

Initial backoff delay in ms (default: 1000)

##### maxBackoffMs?

> `optional` **maxBackoffMs**: `number`

Defined in: [client/src/offline/background-sync.ts:53](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L53)

Maximum backoff delay in ms (default: 60000)

##### maxConsecutiveFailures?

> `optional` **maxConsecutiveFailures**: `number`

Defined in: [client/src/offline/background-sync.ts:55](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L55)

Maximum consecutive failures before stopping (default: Infinity)

***

### PriorityMutation

Defined in: [client/src/offline/background-sync.ts:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L58)

#### Properties

##### id

> **id**: `string`

Defined in: [client/src/offline/background-sync.ts:59](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L59)

##### mutationName

> **mutationName**: `string`

Defined in: [client/src/offline/background-sync.ts:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L60)

##### args

> **args**: `unknown`

Defined in: [client/src/offline/background-sync.ts:61](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L61)

##### priority

> **priority**: `"low"` \| `"high"` \| `"critical"` \| `"normal"`

Defined in: [client/src/offline/background-sync.ts:62](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L62)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/offline/background-sync.ts:63](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L63)

***

### Conflict

Defined in: [client/src/offline/conflict-resolver.ts:15](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L15)

#### Properties

##### localChange

> **localChange**: `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L17)

The local (client) change

##### remoteChange

> **remoteChange**: `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L19)

The remote (server) change

##### table

> **table**: `string`

Defined in: [client/src/offline/conflict-resolver.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L21)

Table or collection name

##### rowId

> **rowId**: `string`

Defined in: [client/src/offline/conflict-resolver.ts:23](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L23)

Row or document ID

##### resolvedValue?

> `optional` **resolvedValue**: `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:25](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L25)

The resolved value after conflict resolution

##### strategy?

> `optional` **strategy**: [`ConflictStrategyType`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictstrategytype)

Defined in: [client/src/offline/conflict-resolver.ts:27](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L27)

Which strategy was used to resolve

***

### ConflictResolutionConfig

Defined in: [client/src/offline/conflict-resolver.ts:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L30)

#### Properties

##### defaultStrategy?

> `optional` **defaultStrategy**: [`ConflictStrategyType`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictstrategytype)

Defined in: [client/src/offline/conflict-resolver.ts:32](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L32)

Default strategy for all tables (default: "last-write-wins")

##### tableStrategies?

> `optional` **tableStrategies**: `Record`\<`string`, [`ConflictStrategyType`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictstrategytype)\>

Defined in: [client/src/offline/conflict-resolver.ts:34](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L34)

Per-table strategy overrides

##### customResolver()?

> `optional` **customResolver**: (`conflict`) => `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L36)

Custom resolver function (required when strategy is "custom")

###### Parameters

###### conflict

[`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)

###### Returns

`Record`\<`string`, `unknown`\>

***

### ConflictLogEntry

Defined in: [client/src/offline/conflict-resolver.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L39)

#### Properties

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/offline/conflict-resolver.ts:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L41)

When the conflict was resolved

##### conflict

> **conflict**: [`Conflict`](client%20-%20Framework-agnostic%20client%20SDK.md#conflict)

Defined in: [client/src/offline/conflict-resolver.ts:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L43)

The original conflict

##### strategy

> **strategy**: [`ConflictStrategyType`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictstrategytype)

Defined in: [client/src/offline/conflict-resolver.ts:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L45)

The strategy applied

##### resolvedValue

> **resolvedValue**: `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/conflict-resolver.ts:47](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L47)

The resolved value

***

### OfflineStorage

Defined in: [client/src/offline/offline.ts:8](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L8)

Offline-first client support for ReactiveBase.
Provides persistent query cache, mutation queue, and sync protocol.

Uses a pluggable storage interface (IndexedDB, localStorage, or in-memory).

#### Methods

##### get()

> **get**(`key`): `Promise`\<`unknown`\>

Defined in: [client/src/offline/offline.ts:9](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L9)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`unknown`\>

##### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L10)

###### Parameters

###### key

`string`

###### value

`unknown`

###### Returns

`Promise`\<`void`\>

##### delete()

> **delete**(`key`): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:11](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L11)

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`void`\>

##### keys()

> **keys**(): `Promise`\<`string`[]\>

Defined in: [client/src/offline/offline.ts:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L12)

###### Returns

`Promise`\<`string`[]\>

##### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [client/src/offline/offline.ts:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L13)

###### Returns

`Promise`\<`void`\>

***

### PendingMutation

Defined in: [client/src/offline/offline.ts:16](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L16)

#### Properties

##### id

> **id**: `string`

Defined in: [client/src/offline/offline.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L17)

##### mutationName

> **mutationName**: `string`

Defined in: [client/src/offline/offline.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L18)

##### args

> **args**: `unknown`

Defined in: [client/src/offline/offline.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L19)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/offline/offline.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L20)

##### retries

> **retries**: `number`

Defined in: [client/src/offline/offline.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L21)

***

### OfflineOptions

Defined in: [client/src/offline/offline.ts:24](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L24)

#### Properties

##### storage

> **storage**: [`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

Defined in: [client/src/offline/offline.ts:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L26)

Storage backend

##### maxQueueSize?

> `optional` **maxQueueSize**: `number`

Defined in: [client/src/offline/offline.ts:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L28)

Max mutations to queue while offline (default: 1000)

##### conflictStrategy?

> `optional` **conflictStrategy**: `"last-write-wins"` \| `"server-wins"` \| `"client-wins"`

Defined in: [client/src/offline/offline.ts:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L30)

Conflict resolution strategy

***

### CachedQuery

Defined in: [client/src/offline/offline.ts:81](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L81)

#### Properties

##### queryName

> **queryName**: `string`

Defined in: [client/src/offline/offline.ts:82](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L82)

##### argsKey

> **argsKey**: `string`

Defined in: [client/src/offline/offline.ts:83](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L83)

##### data

> **data**: `unknown`

Defined in: [client/src/offline/offline.ts:84](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L84)

##### version

> **version**: `number`

Defined in: [client/src/offline/offline.ts:85](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L85)

##### cachedAt

> **cachedAt**: `number`

Defined in: [client/src/offline/offline.ts:86](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L86)

***

### SyncResult

Defined in: [client/src/offline/offline.ts:218](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L218)

#### Properties

##### synced

> **synced**: `number`

Defined in: [client/src/offline/offline.ts:219](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L219)

##### failed

> **failed**: `number`

Defined in: [client/src/offline/offline.ts:220](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L220)

##### errors

> **errors**: `object`[]

Defined in: [client/src/offline/offline.ts:221](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/offline.ts#L221)

###### id

> **id**: `string`

###### error

> **error**: `string`

***

### SQLiteAdapter

Defined in: [client/src/offline/sqlite-cache.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L18)

#### Methods

##### run()

> **run**(`sql`, `params`?): `Promise`\<`void`\>

Defined in: [client/src/offline/sqlite-cache.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L20)

Execute a write statement (INSERT, UPDATE, DELETE, CREATE)

###### Parameters

###### sql

`string`

###### params?

`unknown`[]

###### Returns

`Promise`\<`void`\>

##### get()

> **get**\<`T`\>(`sql`, `params`?): `Promise`\<`undefined` \| `T`\>

Defined in: [client/src/offline/sqlite-cache.ts:22](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L22)

Fetch a single row

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### sql

`string`

###### params?

`unknown`[]

###### Returns

`Promise`\<`undefined` \| `T`\>

##### all()

> **all**\<`T`\>(`sql`, `params`?): `Promise`\<`T`[]\>

Defined in: [client/src/offline/sqlite-cache.ts:24](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L24)

Fetch all matching rows

###### Type Parameters

• **T** = `unknown`

###### Parameters

###### sql

`string`

###### params?

`unknown`[]

###### Returns

`Promise`\<`T`[]\>

***

### SQLiteCacheOptions

Defined in: [client/src/offline/sqlite-cache.ts:27](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L27)

#### Properties

##### adapter

> **adapter**: [`SQLiteAdapter`](client%20-%20Framework-agnostic%20client%20SDK.md#sqliteadapter)

Defined in: [client/src/offline/sqlite-cache.ts:29](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L29)

SQLite adapter instance

##### tableName?

> `optional` **tableName**: `string`

Defined in: [client/src/offline/sqlite-cache.ts:31](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L31)

Table name for the cache (default: "rb_cache")

##### maxEntries?

> `optional` **maxEntries**: `number`

Defined in: [client/src/offline/sqlite-cache.ts:33](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L33)

Maximum number of entries before LRU eviction (default: 10000)

##### defaultTTLMs?

> `optional` **defaultTTLMs**: `number`

Defined in: [client/src/offline/sqlite-cache.ts:35](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L35)

Default TTL in milliseconds (default: 0 = no expiration)

***

### CacheMetadata

Defined in: [client/src/offline/sqlite-cache.ts:38](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L38)

#### Properties

##### entryCount

> **entryCount**: `number`

Defined in: [client/src/offline/sqlite-cache.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L40)

Number of entries in the cache

##### totalBytes

> **totalBytes**: `number`

Defined in: [client/src/offline/sqlite-cache.ts:42](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L42)

Total serialized size in bytes

##### oldestEntryAt

> **oldestEntryAt**: `null` \| `number`

Defined in: [client/src/offline/sqlite-cache.ts:44](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L44)

Timestamp of the oldest entry (ms since epoch), or null if empty

##### newestEntryAt

> **newestEntryAt**: `null` \| `number`

Defined in: [client/src/offline/sqlite-cache.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L46)

Timestamp of the newest entry (ms since epoch), or null if empty

***

### SyncEngineOptions

Defined in: [client/src/offline/sync-engine.ts:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L26)

#### Properties

##### storage

> **storage**: [`OfflineStorage`](client%20-%20Framework-agnostic%20client%20SDK.md#offlinestorage)

Defined in: [client/src/offline/sync-engine.ts:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L28)

Client storage backend

##### clientId

> **clientId**: `string`

Defined in: [client/src/offline/sync-engine.ts:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L30)

Unique client identifier

##### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [client/src/offline/sync-engine.ts:32](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L32)

Max retry attempts per mutation (default: 5)

##### initialBackoffMs?

> `optional` **initialBackoffMs**: `number`

Defined in: [client/src/offline/sync-engine.ts:34](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L34)

Initial backoff delay in ms (default: 1000)

##### maxBackoffMs?

> `optional` **maxBackoffMs**: `number`

Defined in: [client/src/offline/sync-engine.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L36)

Max backoff delay in ms (default: 30000)

##### batchSize?

> `optional` **batchSize**: `number`

Defined in: [client/src/offline/sync-engine.ts:38](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L38)

Batch size for mutation replay (default: 10)

##### conflictStrategy?

> `optional` **conflictStrategy**: [`ConflictStrategy`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictstrategy-2)

Defined in: [client/src/offline/sync-engine.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L40)

Conflict resolution strategy (default: "last-write-wins")

##### customMerge?

> `optional` **customMerge**: [`MergeFunction`](client%20-%20Framework-agnostic%20client%20SDK.md#mergefunction)

Defined in: [client/src/offline/sync-engine.ts:42](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L42)

Custom merge function for "custom" strategy

##### onSyncStatus()?

> `optional` **onSyncStatus**: (`status`) => `void`

Defined in: [client/src/offline/sync-engine.ts:44](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L44)

Callback for sync status changes

###### Parameters

###### status

[`SyncStatus`](client%20-%20Framework-agnostic%20client%20SDK.md#syncstatus-1)

###### Returns

`void`

##### onConflict()?

> `optional` **onConflict**: (`conflict`) => `void`

Defined in: [client/src/offline/sync-engine.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L46)

Callback for conflict notifications

###### Parameters

###### conflict

[`SyncConflict`](client%20-%20Framework-agnostic%20client%20SDK.md#syncconflict)

###### Returns

`void`

***

### VectorClock

Defined in: [client/src/offline/sync-engine.ts:53](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L53)

#### Indexable

\[`clientId`: `string`\]: `number`

***

### SyncStatus

Defined in: [client/src/offline/sync-engine.ts:57](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L57)

#### Properties

##### state

> **state**: `"error"` \| `"syncing"` \| `"idle"` \| `"offline"`

Defined in: [client/src/offline/sync-engine.ts:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L58)

##### pendingMutations

> **pendingMutations**: `number`

Defined in: [client/src/offline/sync-engine.ts:59](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L59)

##### lastSyncAt

> **lastSyncAt**: `null` \| `number`

Defined in: [client/src/offline/sync-engine.ts:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L60)

##### lastError

> **lastError**: `null` \| `string`

Defined in: [client/src/offline/sync-engine.ts:61](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L61)

##### syncProgress

> **syncProgress**: `null` \| \{ `current`: `number`; `total`: `number`; \}

Defined in: [client/src/offline/sync-engine.ts:62](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L62)

***

### SyncConflict

Defined in: [client/src/offline/sync-engine.ts:65](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L65)

#### Properties

##### mutationId

> **mutationId**: `string`

Defined in: [client/src/offline/sync-engine.ts:66](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L66)

##### mutationName

> **mutationName**: `string`

Defined in: [client/src/offline/sync-engine.ts:67](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L67)

##### clientArgs

> **clientArgs**: `unknown`

Defined in: [client/src/offline/sync-engine.ts:68](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L68)

##### serverState

> **serverState**: `unknown`

Defined in: [client/src/offline/sync-engine.ts:69](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L69)

##### resolution

> **resolution**: `"merged"` \| `"server-wins"` \| `"client-wins"` \| `"dropped"`

Defined in: [client/src/offline/sync-engine.ts:70](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L70)

##### resolvedValue?

> `optional` **resolvedValue**: `unknown`

Defined in: [client/src/offline/sync-engine.ts:71](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L71)

***

### SyncBatchResult

Defined in: [client/src/offline/sync-engine.ts:74](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L74)

#### Properties

##### synced

> **synced**: `number`

Defined in: [client/src/offline/sync-engine.ts:75](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L75)

##### failed

> **failed**: `number`

Defined in: [client/src/offline/sync-engine.ts:76](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L76)

##### conflicts

> **conflicts**: [`SyncConflict`](client%20-%20Framework-agnostic%20client%20SDK.md#syncconflict)[]

Defined in: [client/src/offline/sync-engine.ts:77](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L77)

##### durationMs

> **durationMs**: `number`

Defined in: [client/src/offline/sync-engine.ts:78](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L78)

***

### VersionedValue

Defined in: [client/src/offline/sync-engine.ts:81](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L81)

#### Properties

##### value

> **value**: `unknown`

Defined in: [client/src/offline/sync-engine.ts:82](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L82)

##### clock

> **clock**: [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:83](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L83)

##### clientId

> **clientId**: `string`

Defined in: [client/src/offline/sync-engine.ts:84](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L84)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/offline/sync-engine.ts:85](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L85)

***

### DeltaChange

Defined in: [client/src/offline/sync-engine.ts:88](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L88)

#### Properties

##### table

> **table**: `string`

Defined in: [client/src/offline/sync-engine.ts:89](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L89)

##### rowId

> **rowId**: `string`

Defined in: [client/src/offline/sync-engine.ts:90](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L90)

##### fields

> **fields**: `Record`\<`string`, `unknown`\>

Defined in: [client/src/offline/sync-engine.ts:91](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L91)

##### clock

> **clock**: [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:92](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L92)

##### clientId

> **clientId**: `string`

Defined in: [client/src/offline/sync-engine.ts:93](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L93)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/offline/sync-engine.ts:94](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L94)

***

### OptimisticUpdate

Defined in: [client/src/optimistic/optimistic.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L21)

Optimistic Updates with Automatic Rollback for ReactiveBase Client.
Provides client-side optimistic mutation pipeline where mutations apply locally
immediately, sync to server, and automatically rollback if rejected.

Usage:
  const manager = new OptimisticUpdateManager(queryCache)
  const result = manager.apply({
    mutationId: "m1",
    subscriptionId: "sub_tasks",
    optimisticData: [...currentTasks, newTask],
  })
  // On server confirm:
  manager.confirm("m1", serverData)
  // On server reject:
  manager.rollback("m1") // Restores original data

#### Properties

##### mutationId

> **mutationId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:23](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L23)

Unique mutation identifier

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:25](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L25)

Subscription ID to update optimistically

##### optimisticData

> **optimisticData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:27](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L27)

The optimistic data to show immediately

##### rollbackData?

> `optional` **rollbackData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:29](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L29)

Optional: custom rollback data (defaults to pre-mutation snapshot)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/optimistic/optimistic.ts:31](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L31)

Timestamp of the optimistic update

***

### OptimisticSnapshot

Defined in: [client/src/optimistic/optimistic.ts:34](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L34)

#### Properties

##### mutationId

> **mutationId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:35](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L35)

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L36)

##### originalData

> **originalData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:37](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L37)

##### originalVersion

> **originalVersion**: `number`

Defined in: [client/src/optimistic/optimistic.ts:38](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L38)

##### optimisticData

> **optimisticData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L39)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/optimistic/optimistic.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L40)

##### status

> **status**: `"rolled-back"` \| `"expired"` \| `"pending"` \| `"confirmed"`

Defined in: [client/src/optimistic/optimistic.ts:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L41)

***

### OptimisticManagerOptions

Defined in: [client/src/optimistic/optimistic.ts:44](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L44)

#### Properties

##### maxSnapshots?

> `optional` **maxSnapshots**: `number`

Defined in: [client/src/optimistic/optimistic.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L46)

Max number of snapshots to retain (default: 50)

##### timeoutMs?

> `optional` **timeoutMs**: `number`

Defined in: [client/src/optimistic/optimistic.ts:48](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L48)

Timeout in ms before auto-rolling back unconfirmed mutations (default: 30000)

##### onRollback()?

> `optional` **onRollback**: (`snapshot`) => `void`

Defined in: [client/src/optimistic/optimistic.ts:50](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L50)

Callback when a rollback occurs

###### Parameters

###### snapshot

[`OptimisticSnapshot`](client%20-%20Framework-agnostic%20client%20SDK.md#optimisticsnapshot)

###### Returns

`void`

##### onConfirm()?

> `optional` **onConfirm**: (`mutationId`) => `void`

Defined in: [client/src/optimistic/optimistic.ts:52](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L52)

Callback when a mutation is confirmed

###### Parameters

###### mutationId

`string`

###### Returns

`void`

##### onTimeout()?

> `optional` **onTimeout**: (`mutationId`) => `void`

Defined in: [client/src/optimistic/optimistic.ts:54](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L54)

Callback when a mutation times out

###### Parameters

###### mutationId

`string`

###### Returns

`void`

***

### ConflictInfo

Defined in: [client/src/optimistic/optimistic.ts:57](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L57)

#### Properties

##### mutationId

> **mutationId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L58)

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/optimistic/optimistic.ts:59](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L59)

##### localData

> **localData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L60)

##### serverData

> **serverData**: `unknown`

Defined in: [client/src/optimistic/optimistic.ts:61](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L61)

##### resolution

> **resolution**: `"custom"` \| `"pending"` \| `"local"` \| `"server"`

Defined in: [client/src/optimistic/optimistic.ts:62](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L62)

***

### OptimisticCacheAdapter

Defined in: [client/src/optimistic/optimistic.ts:68](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L68)

Minimal cache interface to avoid tight coupling

#### Methods

##### get()

> **get**(`subscriptionId`): `undefined` \| \{ `data`: `unknown`; `version`: `number`; \}

Defined in: [client/src/optimistic/optimistic.ts:69](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L69)

###### Parameters

###### subscriptionId

`string`

###### Returns

`undefined` \| \{ `data`: `unknown`; `version`: `number`; \}

##### update()

> **update**(`subscriptionId`, `data`, `version`): `void`

Defined in: [client/src/optimistic/optimistic.ts:70](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L70)

###### Parameters

###### subscriptionId

`string`

###### data

`unknown`

###### version

`number`

###### Returns

`void`

***

### SubscriptionEvent

Defined in: [client/src/subscription/client-middleware.ts:16](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L16)

Subscription Lifecycle Hooks & Client Middleware for ReactiveBase.

Implements a client-side middleware pipeline for subscriptions with
onSubscribe, onUpdate, onError, onStale, onReconnect hooks.

Usage:
  const client = new ReactiveBaseClient({
    url: "ws://localhost:3001",
    middleware: [loggingMiddleware(), retryMiddleware({ maxRetries: 3 })],
  })

#### Extended by

- [`SubscriptionUpdateEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionupdateevent)
- [`SubscriptionErrorEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionerrorevent)
- [`SubscriptionStaleEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionstaleevent)

#### Properties

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/subscription/client-middleware.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L17)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/client-middleware.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L18)

##### args

> **args**: `unknown`

Defined in: [client/src/subscription/client-middleware.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L19)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L20)

***

### SubscriptionUpdateEvent

Defined in: [client/src/subscription/client-middleware.ts:23](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L23)

Subscription Lifecycle Hooks & Client Middleware for ReactiveBase.

Implements a client-side middleware pipeline for subscriptions with
onSubscribe, onUpdate, onError, onStale, onReconnect hooks.

Usage:
  const client = new ReactiveBaseClient({
    url: "ws://localhost:3001",
    middleware: [loggingMiddleware(), retryMiddleware({ maxRetries: 3 })],
  })

#### Extends

- [`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

#### Properties

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/subscription/client-middleware.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L17)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`subscriptionId`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionid-3)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/client-middleware.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L18)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`queryName`](client%20-%20Framework-agnostic%20client%20SDK.md#queryname-3)

##### args

> **args**: `unknown`

Defined in: [client/src/subscription/client-middleware.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L19)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`args`](client%20-%20Framework-agnostic%20client%20SDK.md#args-5)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L20)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`timestamp`](client%20-%20Framework-agnostic%20client%20SDK.md#timestamp-9)

##### data

> **data**: `unknown`

Defined in: [client/src/subscription/client-middleware.ts:24](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L24)

##### version

> **version**: `number`

Defined in: [client/src/subscription/client-middleware.ts:25](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L25)

##### sincePreviousMs

> **sincePreviousMs**: `null` \| `number`

Defined in: [client/src/subscription/client-middleware.ts:27](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L27)

Time since last update in ms

***

### SubscriptionErrorEvent

Defined in: [client/src/subscription/client-middleware.ts:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L30)

Subscription Lifecycle Hooks & Client Middleware for ReactiveBase.

Implements a client-side middleware pipeline for subscriptions with
onSubscribe, onUpdate, onError, onStale, onReconnect hooks.

Usage:
  const client = new ReactiveBaseClient({
    url: "ws://localhost:3001",
    middleware: [loggingMiddleware(), retryMiddleware({ maxRetries: 3 })],
  })

#### Extends

- [`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

#### Properties

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/subscription/client-middleware.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L17)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`subscriptionId`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionid-3)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/client-middleware.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L18)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`queryName`](client%20-%20Framework-agnostic%20client%20SDK.md#queryname-3)

##### args

> **args**: `unknown`

Defined in: [client/src/subscription/client-middleware.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L19)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`args`](client%20-%20Framework-agnostic%20client%20SDK.md#args-5)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L20)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`timestamp`](client%20-%20Framework-agnostic%20client%20SDK.md#timestamp-9)

##### error

> **error**: `Error`

Defined in: [client/src/subscription/client-middleware.ts:31](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L31)

##### errorCount

> **errorCount**: `number`

Defined in: [client/src/subscription/client-middleware.ts:33](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L33)

Number of consecutive errors

***

### SubscriptionStaleEvent

Defined in: [client/src/subscription/client-middleware.ts:36](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L36)

Subscription Lifecycle Hooks & Client Middleware for ReactiveBase.

Implements a client-side middleware pipeline for subscriptions with
onSubscribe, onUpdate, onError, onStale, onReconnect hooks.

Usage:
  const client = new ReactiveBaseClient({
    url: "ws://localhost:3001",
    middleware: [loggingMiddleware(), retryMiddleware({ maxRetries: 3 })],
  })

#### Extends

- [`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

#### Properties

##### subscriptionId

> **subscriptionId**: `string`

Defined in: [client/src/subscription/client-middleware.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L17)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`subscriptionId`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionid-3)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/client-middleware.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L18)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`queryName`](client%20-%20Framework-agnostic%20client%20SDK.md#queryname-3)

##### args

> **args**: `unknown`

Defined in: [client/src/subscription/client-middleware.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L19)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`args`](client%20-%20Framework-agnostic%20client%20SDK.md#args-5)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L20)

###### Inherited from

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent).[`timestamp`](client%20-%20Framework-agnostic%20client%20SDK.md#timestamp-9)

##### staleForMs

> **staleForMs**: `number`

Defined in: [client/src/subscription/client-middleware.ts:38](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L38)

How long data has been stale in ms

##### lastUpdateAt

> **lastUpdateAt**: `number`

Defined in: [client/src/subscription/client-middleware.ts:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L39)

***

### SubscriptionReconnectEvent

Defined in: [client/src/subscription/client-middleware.ts:42](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L42)

#### Properties

##### attempt

> **attempt**: `number`

Defined in: [client/src/subscription/client-middleware.ts:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L43)

##### maxAttempts

> **maxAttempts**: `number`

Defined in: [client/src/subscription/client-middleware.ts:44](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L44)

##### backoffMs

> **backoffMs**: `number`

Defined in: [client/src/subscription/client-middleware.ts:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L45)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:46](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L46)

***

### ClientSubscriptionMiddleware

Defined in: [client/src/subscription/client-middleware.ts:51](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L51)

#### Properties

##### name

> **name**: `string`

Defined in: [client/src/subscription/client-middleware.ts:53](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L53)

Unique middleware name for identification

##### onSubscribe()?

> `optional` **onSubscribe**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:56](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L56)

Called when a new subscription is created

###### Parameters

###### event

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### onUpdate()?

> `optional` **onUpdate**: (`event`) => `unknown`

Defined in: [client/src/subscription/client-middleware.ts:59](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L59)

Called when subscription data is updated

###### Parameters

###### event

[`SubscriptionUpdateEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionupdateevent)

###### Returns

`unknown`

##### onError()?

> `optional` **onError**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:62](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L62)

Called when a subscription error occurs

###### Parameters

###### event

[`SubscriptionErrorEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionerrorevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### onStale()?

> `optional` **onStale**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:65](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L65)

Called when subscription data becomes stale (no updates for threshold)

###### Parameters

###### event

[`SubscriptionStaleEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionstaleevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### onReconnect()?

> `optional` **onReconnect**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:68](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L68)

Called on WebSocket reconnection attempt

###### Parameters

###### event

[`SubscriptionReconnectEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionreconnectevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### onUnsubscribe()?

> `optional` **onUnsubscribe**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [client/src/subscription/client-middleware.ts:71](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L71)

Called when a subscription is removed

###### Parameters

###### event

[`SubscriptionEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#subscriptionevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### AnalyticsMetric

Defined in: [client/src/subscription/client-middleware.ts:321](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L321)

#### Properties

##### type

> **type**: `"update"` \| `"error"` \| `"subscribe"` \| `"unsubscribe"` \| `"reconnect"`

Defined in: [client/src/subscription/client-middleware.ts:322](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L322)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/client-middleware.ts:323](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L323)

##### timestamp

> **timestamp**: `number`

Defined in: [client/src/subscription/client-middleware.ts:324](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L324)

##### durationMs?

> `optional` **durationMs**: `number`

Defined in: [client/src/subscription/client-middleware.ts:325](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L325)

##### error?

> `optional` **error**: `string`

Defined in: [client/src/subscription/client-middleware.ts:326](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L326)

##### lifetimeMs?

> `optional` **lifetimeMs**: `number`

Defined in: [client/src/subscription/client-middleware.ts:327](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L327)

##### totalUpdates?

> `optional` **totalUpdates**: `number`

Defined in: [client/src/subscription/client-middleware.ts:328](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L328)

##### totalErrors?

> `optional` **totalErrors**: `number`

Defined in: [client/src/subscription/client-middleware.ts:329](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L329)

***

### SubscriptionHandle

Defined in: [client/src/subscription/subscription-manager.ts:9](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L9)

#### Properties

##### id

> **id**: `string`

Defined in: [client/src/subscription/subscription-manager.ts:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L10)

##### queryName

> **queryName**: `string`

Defined in: [client/src/subscription/subscription-manager.ts:11](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L11)

##### args

> **args**: `unknown`

Defined in: [client/src/subscription/subscription-manager.ts:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L12)

##### unsubscribe()

> **unsubscribe**: () => `void`

Defined in: [client/src/subscription/subscription-manager.ts:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L13)

###### Returns

`void`

***

### ReactiveBaseClientOptions

Defined in: [client/src/subscription/subscription-manager.ts:16](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L16)

#### Properties

##### url

> **url**: `string`

Defined in: [client/src/subscription/subscription-manager.ts:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L17)

##### token?

> `optional` **token**: `string`

Defined in: [client/src/subscription/subscription-manager.ts:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L18)

## Type Aliases

### ConnectionStatus

> **ConnectionStatus**: `"connecting"` \| `"connected"` \| `"disconnected"` \| `"reconnecting"`

Defined in: [client/src/connection/connection-manager.ts:6](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/connection/connection-manager.ts#L6)

WebSocket connection manager for the ReactiveBase client.
Handles connection lifecycle, reconnection, and message routing.

***

### DevToolsEventType

> **DevToolsEventType**: `"subscription:created"` \| `"subscription:updated"` \| `"subscription:removed"` \| `"mutation:started"` \| `"mutation:completed"` \| `"mutation:failed"` \| `"cache:hit"` \| `"cache:miss"` \| `"cache:update"` \| `"ws:message:sent"` \| `"ws:message:received"` \| `"ws:connected"` \| `"ws:disconnected"` \| `"optimistic:applied"` \| `"optimistic:confirmed"` \| `"optimistic:rolledback"`

Defined in: [client/src/devtools/devtools.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L21)

***

### DevToolsEventHandler()

> **DevToolsEventHandler**: (`event`) => `void`

Defined in: [client/src/devtools/devtools.ts:93](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/devtools/devtools.ts#L93)

#### Parameters

##### event

[`DevToolsEvent`](client%20-%20Framework-agnostic%20client%20SDK.md#devtoolsevent)

#### Returns

`void`

***

### TabRole

> **TabRole**: `"leader"` \| `"follower"` \| `"electing"`

Defined in: [client/src/multitab/multi-tab.ts:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/multitab/multi-tab.ts#L13)

***

### SyncState

> **SyncState**: `"idle"` \| `"syncing"` \| `"error"` \| `"offline"`

Defined in: [client/src/offline/background-sync.ts:19](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/background-sync.ts#L19)

***

### ConflictStrategyType

> **ConflictStrategyType**: `"last-write-wins"` \| `"server-wins"` \| `"client-wins"` \| `"field-merge"` \| `"custom"`

Defined in: [client/src/offline/conflict-resolver.ts:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/conflict-resolver.ts#L13)

Configurable conflict resolution for offline-first sync.
Provides multiple strategies including 3-way field-level merge,
per-table strategy overrides, and a conflict log for debugging.

Usage:
  const resolver = new ConflictResolver({ defaultStrategy: "field-merge" })
  const resolved = resolver.resolve(conflict)

***

### ConflictStrategy

> **ConflictStrategy**: `"last-write-wins"` \| `"server-wins"` \| `"client-wins"` \| `"custom"`

Defined in: [client/src/offline/sync-engine.ts:49](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L49)

***

### MergeFunction()

> **MergeFunction**: (`clientValue`, `serverValue`, `baseValue`) => `unknown`

Defined in: [client/src/offline/sync-engine.ts:51](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L51)

#### Parameters

##### clientValue

`unknown`

##### serverValue

`unknown`

##### baseValue

`unknown` | `undefined`

#### Returns

`unknown`

***

### OptimisticConflictResolver()

> **OptimisticConflictResolver**: (`conflict`) => `unknown` \| `Promise`\<`unknown`\>

Defined in: [client/src/optimistic/optimistic.ts:65](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/optimistic/optimistic.ts#L65)

#### Parameters

##### conflict

[`ConflictInfo`](client%20-%20Framework-agnostic%20client%20SDK.md#conflictinfo)

#### Returns

`unknown` \| `Promise`\<`unknown`\>

***

### QueryListener()

> **QueryListener**: (`data`, `error`?) => `void`

Defined in: [client/src/subscription/subscription-manager.ts:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/subscription-manager.ts#L21)

#### Parameters

##### data

`unknown`

##### error?

`Error`

#### Returns

`void`

## Functions

### generateCacheTableSQL()

> **generateCacheTableSQL**(`tableName`): `string`[]

Defined in: [client/src/offline/sqlite-cache.ts:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sqlite-cache.ts#L60)

#### Parameters

##### tableName

`string` = `"rb_cache"`

#### Returns

`string`[]

***

### createVectorClock()

> **createVectorClock**(`clientId`): [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:99](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L99)

#### Parameters

##### clientId

`string`

#### Returns

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

***

### incrementClock()

> **incrementClock**(`clock`, `clientId`): [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:103](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L103)

#### Parameters

##### clock

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### clientId

`string`

#### Returns

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

***

### mergeClock()

> **mergeClock**(`a`, `b`): [`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

Defined in: [client/src/offline/sync-engine.ts:107](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L107)

#### Parameters

##### a

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### b

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

#### Returns

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

***

### happensBefore()

> **happensBefore**(`a`, `b`): `boolean`

Defined in: [client/src/offline/sync-engine.ts:115](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L115)

#### Parameters

##### a

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### b

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

#### Returns

`boolean`

***

### areConcurrent()

> **areConcurrent**(`a`, `b`): `boolean`

Defined in: [client/src/offline/sync-engine.ts:126](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L126)

#### Parameters

##### a

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### b

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

#### Returns

`boolean`

***

### clocksEqual()

> **clocksEqual**(`a`, `b`): `boolean`

Defined in: [client/src/offline/sync-engine.ts:130](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/offline/sync-engine.ts#L130)

#### Parameters

##### a

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

##### b

[`VectorClock`](client%20-%20Framework-agnostic%20client%20SDK.md#vectorclock-1)

#### Returns

`boolean`

***

### encodeMessage()

> **encodeMessage**(`message`): `ArrayBuffer`

Defined in: [client/src/protocol/binary-protocol.ts:40](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/protocol/binary-protocol.ts#L40)

Encode a message to binary format.

#### Parameters

##### message

`Record`\<`string`, `unknown`\>

#### Returns

`ArrayBuffer`

***

### decodeMessage()

> **decodeMessage**(`data`): `Record`\<`string`, `unknown`\>

Defined in: [client/src/protocol/binary-protocol.ts:66](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/protocol/binary-protocol.ts#L66)

Decode a binary message back to a JSON object.

#### Parameters

##### data

`ArrayBuffer`

#### Returns

`Record`\<`string`, `unknown`\>

***

### isBinaryMessage()

> **isBinaryMessage**(`data`): `data is ArrayBuffer`

Defined in: [client/src/protocol/binary-protocol.ts:86](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/protocol/binary-protocol.ts#L86)

Check if a WebSocket message is binary.

#### Parameters

##### data

`unknown`

#### Returns

`data is ArrayBuffer`

***

### compressionRatio()

> **compressionRatio**(`message`): `number`

Defined in: [client/src/protocol/binary-protocol.ts:93](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/protocol/binary-protocol.ts#L93)

Calculate compression ratio vs JSON.

#### Parameters

##### message

`Record`\<`string`, `unknown`\>

#### Returns

`number`

***

### loggingMiddleware()

> **loggingMiddleware**(`options`): [`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

Defined in: [client/src/subscription/client-middleware.ts:206](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L206)

Logging middleware — logs subscription lifecycle events.

#### Parameters

##### options

###### prefix?

`string`

###### verbose?

`boolean`

#### Returns

[`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

***

### retryMiddleware()

> **retryMiddleware**(`options`): [`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

Defined in: [client/src/subscription/client-middleware.ts:237](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L237)

Retry middleware — tracks error counts per subscription for retry logic.

#### Parameters

##### options

###### maxRetries?

`number`

###### backoffMs?

`number`

###### onMaxRetriesReached?

(`queryName`) => `void`

#### Returns

[`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

***

### analyticsMiddleware()

> **analyticsMiddleware**(`options`): [`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)

Defined in: [client/src/subscription/client-middleware.ts:266](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/client/src/subscription/client-middleware.ts#L266)

Analytics middleware — tracks subscription metrics.

#### Parameters

##### options

###### onMetric?

(`metric`) => `void`

#### Returns

[`ClientSubscriptionMiddleware`](client%20-%20Framework-agnostic%20client%20SDK.md#clientsubscriptionmiddleware)
