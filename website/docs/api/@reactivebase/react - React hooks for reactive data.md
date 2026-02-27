[**ReactiveBase API Reference**](../README.md)

***

[ReactiveBase API Reference](../README.md) / @reactivebase/react - React hooks for reactive data

# @reactivebase/react - React hooks for reactive data

## Interfaces

### UseOptimisticOptions

Defined in: [react/src/hooks/collaboration-hooks.tsx:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L26)

#### Properties

##### timeoutMs?

> `optional` **timeoutMs**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L28)

Auto-rollback timeout in ms (default: 30000)

##### maxSnapshots?

> `optional` **maxSnapshots**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L30)

Max snapshots to retain (default: 50)

##### conflictResolver?

> `optional` **conflictResolver**: `ConflictResolver`

Defined in: [react/src/hooks/collaboration-hooks.tsx:32](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L32)

Custom conflict resolver

***

### UseOptimisticReturn\<T\>

Defined in: [react/src/hooks/collaboration-hooks.tsx:35](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L35)

#### Type Parameters

• **T**

#### Properties

##### data

> **data**: `T`

Defined in: [react/src/hooks/collaboration-hooks.tsx:37](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L37)

Current data (may be optimistic)

##### applyOptimistic()

> **applyOptimistic**: (`optimisticData`) => `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L39)

Apply an optimistic update and return the mutation ID

###### Parameters

###### optimisticData

`T`

###### Returns

`string`

##### confirm()

> **confirm**: (`mutationId`, `serverData`?) => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L41)

Confirm a mutation succeeded

###### Parameters

###### mutationId

`string`

###### serverData?

`T`

###### Returns

`void`

##### rollback()

> **rollback**: (`mutationId`) => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L43)

Roll back a specific mutation

###### Parameters

###### mutationId

`string`

###### Returns

`void`

##### rollbackAll()

> **rollbackAll**: () => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L45)

Roll back all pending mutations

###### Returns

`void`

##### isPending

> **isPending**: `boolean`

Defined in: [react/src/hooks/collaboration-hooks.tsx:47](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L47)

Whether there are pending optimistic updates

##### pendingCount

> **pendingCount**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:49](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L49)

Number of pending mutations

***

### CursorData

Defined in: [react/src/hooks/collaboration-hooks.tsx:155](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L155)

#### Properties

##### connectionId

> **connectionId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:156](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L156)

##### userId

> **userId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:157](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L157)

##### userName

> **userName**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:158](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L158)

##### color

> **color**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:159](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L159)

##### x

> **x**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:160](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L160)

##### y

> **y**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:161](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L161)

##### target?

> `optional` **target**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:162](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L162)

***

### TypingUser

Defined in: [react/src/hooks/collaboration-hooks.tsx:165](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L165)

#### Properties

##### connectionId

> **connectionId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:166](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L166)

##### userId

> **userId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:167](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L167)

##### userName

> **userName**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:168](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L168)

***

### SelectionData

Defined in: [react/src/hooks/collaboration-hooks.tsx:171](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L171)

#### Properties

##### connectionId

> **connectionId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:172](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L172)

##### userId

> **userId**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:173](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L173)

##### color

> **color**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:174](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L174)

##### field

> **field**: `string`

Defined in: [react/src/hooks/collaboration-hooks.tsx:175](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L175)

##### start

> **start**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:176](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L176)

##### end

> **end**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:177](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L177)

***

### CollaborationState

Defined in: [react/src/hooks/collaboration-hooks.tsx:180](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L180)

#### Properties

##### cursors

> **cursors**: [`CursorData`](react%20-%20React%20hooks%20for%20reactive%20data.md#cursordata)[]

Defined in: [react/src/hooks/collaboration-hooks.tsx:181](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L181)

##### typingUsers

> **typingUsers**: [`TypingUser`](react%20-%20React%20hooks%20for%20reactive%20data.md#typinguser)[]

Defined in: [react/src/hooks/collaboration-hooks.tsx:182](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L182)

##### selections

> **selections**: [`SelectionData`](react%20-%20React%20hooks%20for%20reactive%20data.md#selectiondata)[]

Defined in: [react/src/hooks/collaboration-hooks.tsx:183](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L183)

##### activeUsers

> **activeUsers**: `number`

Defined in: [react/src/hooks/collaboration-hooks.tsx:184](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L184)

***

### UseDevToolsReturn

Defined in: [react/src/hooks/collaboration-hooks.tsx:299](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L299)

#### Properties

##### summary

> **summary**: `DevToolsSummary`

Defined in: [react/src/hooks/collaboration-hooks.tsx:301](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L301)

Summary stats

##### subscriptions

> **subscriptions**: `SubscriptionInfo`[]

Defined in: [react/src/hooks/collaboration-hooks.tsx:303](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L303)

Active subscriptions

##### mutations

> **mutations**: `MutationInfo`[]

Defined in: [react/src/hooks/collaboration-hooks.tsx:305](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L305)

Recent mutations

##### cacheStats

> **cacheStats**: `CacheStats`

Defined in: [react/src/hooks/collaboration-hooks.tsx:307](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L307)

Cache statistics

##### wsStats

> **wsStats**: `WebSocketStats`

Defined in: [react/src/hooks/collaboration-hooks.tsx:309](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L309)

WebSocket statistics

##### enabled

> **enabled**: `boolean`

Defined in: [react/src/hooks/collaboration-hooks.tsx:311](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L311)

Whether DevTools is enabled

##### setEnabled()

> **setEnabled**: (`enabled`) => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:313](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L313)

Enable/disable DevTools

###### Parameters

###### enabled

`boolean`

###### Returns

`void`

##### takeSnapshot()

> **takeSnapshot**: () => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:315](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L315)

Take a performance snapshot

###### Returns

`void`

##### reset()

> **reset**: () => `void`

Defined in: [react/src/hooks/collaboration-hooks.tsx:317](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L317)

Reset all tracking data

###### Returns

`void`

***

### UseCollabTextReturn

Defined in: [react/src/hooks/crdt-hooks.tsx:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L18)

#### Properties

##### text

> **text**: `string`

Defined in: [react/src/hooks/crdt-hooks.tsx:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L20)

Current text content

##### insert()

> **insert**: (`index`, `text`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:22](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L22)

Insert text at a position

###### Parameters

###### index

`number`

###### text

`string`

###### Returns

`void`

##### deleteRange()

> **deleteRange**: (`index`, `length`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:24](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L24)

Delete text at a position

###### Parameters

###### index

`number`

###### length

`number`

###### Returns

`void`

##### setText()

> **setText**: (`text`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L26)

Replace all text

###### Parameters

###### text

`string`

###### Returns

`void`

##### length

> **length**: `number`

Defined in: [react/src/hooks/crdt-hooks.tsx:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L28)

Text length

##### loading

> **loading**: `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:30](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L30)

Whether the document is loading

##### connected

> **connected**: `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:32](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L32)

Connection status

***

### UseCollabListReturn\<T\>

Defined in: [react/src/hooks/crdt-hooks.tsx:35](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L35)

#### Type Parameters

• **T**

#### Properties

##### items

> **items**: `T`[]

Defined in: [react/src/hooks/crdt-hooks.tsx:37](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L37)

Current items

##### push()

> **push**: (`item`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:39](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L39)

Add an item

###### Parameters

###### item

`T`

###### Returns

`void`

##### remove()

> **remove**: (`item`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:41](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L41)

Remove an item

###### Parameters

###### item

`T`

###### Returns

`void`

##### has()

> **has**: (`item`) => `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:43](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L43)

Check if item exists

###### Parameters

###### item

`T`

###### Returns

`boolean`

##### length

> **length**: `number`

Defined in: [react/src/hooks/crdt-hooks.tsx:45](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L45)

Item count

##### loading

> **loading**: `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:47](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L47)

Whether the list is loading

***

### UseCollabMapReturn\<T\>

Defined in: [react/src/hooks/crdt-hooks.tsx:50](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L50)

#### Type Parameters

• **T**

#### Properties

##### entries

> **entries**: `Record`\<`string`, `T`\>

Defined in: [react/src/hooks/crdt-hooks.tsx:52](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L52)

Current entries

##### get()

> **get**: (`key`) => `undefined` \| `T`

Defined in: [react/src/hooks/crdt-hooks.tsx:54](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L54)

Get a value by key

###### Parameters

###### key

`string`

###### Returns

`undefined` \| `T`

##### set()

> **set**: (`key`, `value`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:56](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L56)

Set a key-value pair

###### Parameters

###### key

`string`

###### value

`T`

###### Returns

`void`

##### deleteKey()

> **deleteKey**: (`key`) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:58](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L58)

Delete a key

###### Parameters

###### key

`string`

###### Returns

`void`

##### keys

> **keys**: `string`[]

Defined in: [react/src/hooks/crdt-hooks.tsx:60](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L60)

All keys

##### loading

> **loading**: `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:62](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L62)

Whether the map is loading

***

### UseCollabCounterReturn

Defined in: [react/src/hooks/crdt-hooks.tsx:65](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L65)

#### Properties

##### value

> **value**: `number`

Defined in: [react/src/hooks/crdt-hooks.tsx:67](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L67)

Current counter value

##### increment()

> **increment**: (`amount`?) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:69](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L69)

Increment the counter

###### Parameters

###### amount?

`number`

###### Returns

`void`

##### decrement()

> **decrement**: (`amount`?) => `void`

Defined in: [react/src/hooks/crdt-hooks.tsx:71](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L71)

Decrement the counter

###### Parameters

###### amount?

`number`

###### Returns

`void`

##### loading

> **loading**: `boolean`

Defined in: [react/src/hooks/crdt-hooks.tsx:73](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L73)

Whether the counter is loading

***

### CollabDocumentInfo

Defined in: [react/src/hooks/crdt-hooks.tsx:76](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L76)

#### Properties

##### docId

> **docId**: `string`

Defined in: [react/src/hooks/crdt-hooks.tsx:77](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L77)

##### type

> **type**: `"list"` \| `"map"` \| `"text"` \| `"counter"`

Defined in: [react/src/hooks/crdt-hooks.tsx:78](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L78)

##### connectedUsers

> **connectedUsers**: `number`

Defined in: [react/src/hooks/crdt-hooks.tsx:79](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L79)

##### lastModified

> **lastModified**: `number`

Defined in: [react/src/hooks/crdt-hooks.tsx:80](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L80)

***

### FunctionReference\<_TArgs, _TReturn\>

Defined in: [react/src/hooks/hooks.tsx:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L12)

A function reference to a server query/mutation/action.
In a real implementation, this would be generated from the schema.

#### Type Parameters

• **_TArgs** = `unknown`

• **_TReturn** = `unknown`

#### Properties

##### \_name

> **\_name**: `string`

Defined in: [react/src/hooks/hooks.tsx:13](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L13)

##### \_type

> **\_type**: `"query"` \| `"mutation"` \| `"action"`

Defined in: [react/src/hooks/hooks.tsx:14](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L14)

##### \_args?

> `optional` **\_args**: `_TArgs`

Defined in: [react/src/hooks/hooks.tsx:16](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L16)

Phantom types for inference — do not use at runtime

##### \_return?

> `optional` **\_return**: `_TReturn`

Defined in: [react/src/hooks/hooks.tsx:17](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L17)

***

### OptimisticUpdateConfig\<TArgs\>

Defined in: [react/src/hooks/hooks.tsx:20](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L20)

#### Type Parameters

• **TArgs** = `unknown`

#### Properties

##### optimisticUpdate()?

> `optional` **optimisticUpdate**: (`localStore`, `args`) => `void`

Defined in: [react/src/hooks/hooks.tsx:21](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L21)

###### Parameters

###### localStore

[`LocalStore`](react%20-%20React%20hooks%20for%20reactive%20data.md#localstore)

###### args

`TArgs`

###### Returns

`void`

***

### LocalStore

Defined in: [react/src/hooks/hooks.tsx:24](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L24)

#### Methods

##### updateQuery()

> **updateQuery**(`queryName`, `updater`): `void`

Defined in: [react/src/hooks/hooks.tsx:26](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L26)

Update a specific query's cached data

###### Parameters

###### queryName

`string`

###### updater

(`data`, `args`) => `unknown`

###### Returns

`void`

##### update()

> **update**(`subscriptionId`, `updater`): `void`

Defined in: [react/src/hooks/hooks.tsx:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L28)

Update a specific subscription by ID

###### Parameters

###### subscriptionId

`string`

###### updater

(`data`) => `unknown`

###### Returns

`void`

***

### UseQueryOptions

Defined in: [react/src/hooks/hooks.tsx:31](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L31)

#### Properties

##### enabled?

> `optional` **enabled**: `boolean`

Defined in: [react/src/hooks/hooks.tsx:33](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L33)

Whether the query is enabled (default: true). Set to false to defer execution.

***

### AggregateQueryOptions

Defined in: [react/src/hooks/hooks.tsx:155](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L155)

#### Properties

##### enabled?

> `optional` **enabled**: `boolean`

Defined in: [react/src/hooks/hooks.tsx:157](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L157)

Whether the query is enabled (default: true). Set to false to defer execution.

***

### AggregateQueryResult\<T\>

Defined in: [react/src/hooks/hooks.tsx:160](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L160)

#### Type Parameters

• **T** = `unknown`

#### Properties

##### data

> **data**: `undefined` \| `T`

Defined in: [react/src/hooks/hooks.tsx:161](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L161)

##### isLoading

> **isLoading**: `boolean`

Defined in: [react/src/hooks/hooks.tsx:162](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L162)

##### error

> **error**: `null` \| `Error`

Defined in: [react/src/hooks/hooks.tsx:163](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L163)

***

### ReactiveBaseProviderProps

Defined in: [react/src/provider/provider.tsx:10](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L10)

#### Properties

##### url

> **url**: `string`

Defined in: [react/src/provider/provider.tsx:11](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L11)

##### token?

> `optional` **token**: `string`

Defined in: [react/src/provider/provider.tsx:12](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L12)

##### middleware?

> `optional` **middleware**: `ClientSubscriptionMiddleware`[]

Defined in: [react/src/provider/provider.tsx:14](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L14)

Client-side subscription middleware pipeline

##### children

> **children**: `ReactNode`

Defined in: [react/src/provider/provider.tsx:15](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L15)

## Functions

### useOptimistic()

> **useOptimistic**\<`T`\>(`serverData`, `options`): [`UseOptimisticReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#useoptimisticreturnt)\<`T`\>

Defined in: [react/src/hooks/collaboration-hooks.tsx:66](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L66)

Hook for managing optimistic updates on a piece of state.
Automatically snapshots, applies, confirms, and rolls back mutations.

Usage:
  const { data, applyOptimistic, confirm, rollback, isPending } = useOptimistic(tasks)
  const mutationId = applyOptimistic([...tasks, newTask])
  try {
    await serverMutation()
    confirm(mutationId)
  } catch {
    rollback(mutationId)
  }

#### Type Parameters

• **T**

#### Parameters

##### serverData

`T`

##### options

[`UseOptimisticOptions`](react%20-%20React%20hooks%20for%20reactive%20data.md#useoptimisticoptions) = `{}`

#### Returns

[`UseOptimisticReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#useoptimisticreturnt)\<`T`\>

***

### useCursors()

> **useCursors**(`roomId`): `object`

Defined in: [react/src/hooks/collaboration-hooks.tsx:194](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L194)

Hook for real-time cursor awareness in a collaboration room.
Returns the list of remote cursors and a function to broadcast local cursor.

Usage:
  const { cursors, updateCursor, clearCursor } = useCursors("doc-123")

#### Parameters

##### roomId

`string`

#### Returns

`object`

##### cursors

> **cursors**: [`CursorData`](react%20-%20React%20hooks%20for%20reactive%20data.md#cursordata)[]

##### updateCursor()

> **updateCursor**: (`position`) => `void`

###### Parameters

###### position

###### x

`number`

###### y

`number`

###### target?

`string`

###### Returns

`void`

##### clearCursor()

> **clearCursor**: () => `void`

###### Returns

`void`

***

### useTypingUsers()

> **useTypingUsers**(`roomId`): `object`

Defined in: [react/src/hooks/collaboration-hooks.tsx:233](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L233)

Hook for typing indicator awareness.
Tracks which users are currently typing in a room.

Usage:
  const { typingUsers, setTyping } = useTypingUsers("doc-123")
  onKeyDown={() => setTyping(true)}

#### Parameters

##### roomId

`string`

#### Returns

`object`

##### typingUsers

> **typingUsers**: [`TypingUser`](react%20-%20React%20hooks%20for%20reactive%20data.md#typinguser)[]

##### setTyping()

> **setTyping**: (`isTyping`) => `void`

###### Parameters

###### isTyping

`boolean`

###### Returns

`void`

***

### useSelections()

> **useSelections**(`roomId`): `object`

Defined in: [react/src/hooks/collaboration-hooks.tsx:266](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L266)

Hook for selection awareness.
Tracks text/element selections from other users in the room.

Usage:
  const { selections, updateSelection, clearSelection } = useSelections("doc-123")

#### Parameters

##### roomId

`string`

#### Returns

`object`

##### selections

> **selections**: [`SelectionData`](react%20-%20React%20hooks%20for%20reactive%20data.md#selectiondata)[]

##### updateSelection()

> **updateSelection**: (`selection`) => `void`

###### Parameters

###### selection

###### field

`string`

###### start

`number`

###### end

`number`

###### Returns

`void`

##### clearSelection()

> **clearSelection**: () => `void`

###### Returns

`void`

***

### useDevTools()

> **useDevTools**(`refreshIntervalMs`): [`UseDevToolsReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usedevtoolsreturn)

Defined in: [react/src/hooks/collaboration-hooks.tsx:327](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/collaboration-hooks.tsx#L327)

Hook for accessing ReactiveBase DevTools data.
Provides live stats for subscriptions, mutations, cache, and WebSocket.

Usage:
  const { summary, subscriptions, mutations } = useDevTools()

#### Parameters

##### refreshIntervalMs

`number` = `2000`

#### Returns

[`UseDevToolsReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usedevtoolsreturn)

***

### useCollabText()

> **useCollabText**(`docId`): [`UseCollabTextReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabtextreturn)

Defined in: [react/src/hooks/crdt-hooks.tsx:85](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L85)

#### Parameters

##### docId

`string`

#### Returns

[`UseCollabTextReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabtextreturn)

***

### useCollabList()

> **useCollabList**\<`T`\>(`docId`): [`UseCollabListReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollablistreturnt)\<`T`\>

Defined in: [react/src/hooks/crdt-hooks.tsx:147](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L147)

#### Type Parameters

• **T** = `unknown`

#### Parameters

##### docId

`string`

#### Returns

[`UseCollabListReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollablistreturnt)\<`T`\>

***

### useCollabMap()

> **useCollabMap**\<`T`\>(`docId`): [`UseCollabMapReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabmapreturnt)\<`T`\>

Defined in: [react/src/hooks/crdt-hooks.tsx:195](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L195)

#### Type Parameters

• **T** = `unknown`

#### Parameters

##### docId

`string`

#### Returns

[`UseCollabMapReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabmapreturnt)\<`T`\>

***

### useCollabCounter()

> **useCollabCounter**(`docId`): [`UseCollabCounterReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabcounterreturn)

Defined in: [react/src/hooks/crdt-hooks.tsx:247](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/crdt-hooks.tsx#L247)

#### Parameters

##### docId

`string`

#### Returns

[`UseCollabCounterReturn`](react%20-%20React%20hooks%20for%20reactive%20data.md#usecollabcounterreturn)

***

### useQuery()

> **useQuery**\<`TResult`, `TArgs`\>(`queryRef`, `args`?, `options`?): `undefined` \| `TResult`

Defined in: [react/src/hooks/hooks.tsx:48](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L48)

Subscribe to a reactive query. Returns `undefined` during loading,
then the typed result. Re-renders when server pushes updates.

When used with a typed FunctionReference, TResult is inferred automatically:
  const tasks = useQuery(api.tasks.listTasks, { userId: "u1" })
  // tasks is Task[] | undefined

Dependent query pattern:
  const user = useQuery(api.users.get, { id: userId })
  const tasks = useQuery(api.tasks.listByUser, { userId: user?.id }, { enabled: !!user })

#### Type Parameters

• **TResult** = `unknown`

• **TArgs** = `unknown`

#### Parameters

##### queryRef

`string` | [`FunctionReference`](react%20-%20React%20hooks%20for%20reactive%20data.md#functionreference_targs-_treturn)\<`TArgs`, `TResult`\>

##### args?

`TArgs`

##### options?

[`UseQueryOptions`](react%20-%20React%20hooks%20for%20reactive%20data.md#usequeryoptions)

#### Returns

`undefined` \| `TResult`

***

### useMutation()

> **useMutation**\<`TArgs`, `TResult`\>(`mutationRef`, `config`?): (`args`) => `Promise`\<`TResult`\>

Defined in: [react/src/hooks/hooks.tsx:93](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L93)

Returns a function that calls a server mutation.
Supports optimistic updates with automatic rollback on failure.

#### Type Parameters

• **TArgs** = `unknown`

• **TResult** = `unknown`

#### Parameters

##### mutationRef

`string` | [`FunctionReference`](react%20-%20React%20hooks%20for%20reactive%20data.md#functionreference_targs-_treturn)\<`TArgs`, `TResult`\>

##### config?

[`OptimisticUpdateConfig`](react%20-%20React%20hooks%20for%20reactive%20data.md#optimisticupdateconfigtargs)\<`TArgs`\>

#### Returns

`Function`

##### Parameters

###### args

`TArgs`

##### Returns

`Promise`\<`TResult`\>

***

### useAction()

> **useAction**\<`TArgs`, `TResult`\>(`actionRef`): (`args`) => `Promise`\<`TResult`\>

Defined in: [react/src/hooks/hooks.tsx:138](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L138)

Returns a function that triggers a background action.

#### Type Parameters

• **TArgs** = `unknown`

• **TResult** = `unknown`

#### Parameters

##### actionRef

`string` | [`FunctionReference`](react%20-%20React%20hooks%20for%20reactive%20data.md#functionreference_targs-_treturn)\<`TArgs`, `TResult`\>

#### Returns

`Function`

##### Parameters

###### args

`TArgs`

##### Returns

`Promise`\<`TResult`\>

***

### useAggregateQuery()

> **useAggregateQuery**\<`TResult`, `TArgs`\>(`queryRef`, `args`?, `options`?): [`AggregateQueryResult`](react%20-%20React%20hooks%20for%20reactive%20data.md#aggregatequeryresultt)\<`TResult`\>

Defined in: [react/src/hooks/hooks.tsx:173](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/hooks/hooks.tsx#L173)

Subscribe to a reactive aggregate query.
Returns aggregated results that update automatically when underlying data changes.

Usage:
  const { data, isLoading } = useAggregateQuery(api.tasks.taskStats, { userId: "u1" })

#### Type Parameters

• **TResult** = `unknown`

• **TArgs** = `unknown`

#### Parameters

##### queryRef

`string` | [`FunctionReference`](react%20-%20React%20hooks%20for%20reactive%20data.md#functionreference_targs-_treturn)\<`TArgs`, `TResult`\>

##### args?

`TArgs`

##### options?

[`AggregateQueryOptions`](react%20-%20React%20hooks%20for%20reactive%20data.md#aggregatequeryoptions)

#### Returns

[`AggregateQueryResult`](react%20-%20React%20hooks%20for%20reactive%20data.md#aggregatequeryresultt)\<`TResult`\>

***

### ReactiveBaseProvider()

> **ReactiveBaseProvider**(`__namedParameters`): `Element`

Defined in: [react/src/provider/provider.tsx:18](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L18)

#### Parameters

##### \_\_namedParameters

[`ReactiveBaseProviderProps`](react%20-%20React%20hooks%20for%20reactive%20data.md#reactivebaseproviderprops)

#### Returns

`Element`

***

### useReactiveBaseClient()

> **useReactiveBaseClient**(): `ReactiveBaseClient`

Defined in: [react/src/provider/provider.tsx:28](https://github.com/josedab/reactivebase/blob/deadc852d0d384e5f93668842c410b98d14c81d8/packages/react/src/provider/provider.tsx#L28)

#### Returns

`ReactiveBaseClient`
