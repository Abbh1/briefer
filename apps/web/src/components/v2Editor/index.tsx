import { Awareness } from 'y-protocols/awareness'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DropTargetMonitor, useDrag, useDrop } from 'react-dnd'
import { useLastUpdatedAt, useYDocState } from '@/hooks/useYDoc'
import * as Y from 'yjs'
import Title from './Title'
import DragHandle from './DragHandle'
import {
  addBlockGroup,
  updateOrder,
  groupBlockGroups,
  checkCanDropBlockGroup,
  removeBlockGroup,
  YBlock,
  checkCanDropBlock,
  groupBlocks,
  BlockType,
  addGroupedBlock,
  getExecStatus,
  requestRun,
  execStatusIsDisabled,
  switchBlockType,
  getPrettyTitle,
  duplicateTab,
  duplicateBlockGroup,
  removeBlock,
  requestTrySuggestion,
  addBlockGroupAfterBlock,
  getBaseAttributes,
  TabRef,
  YBlockGroup,
  canReorderTab,
  getCurrentTabId,
  reorderTab,
  switchActiveTab,
  ungroupTab,
  getTabsFromBlockGroupId,
  toggleIsBlockHiddenInPublished,
  getTabsFromBlockGroup,
  getBlockGroup,
  RemoveBlockGroupResult,
  RemoveBlockDashboardConflictResult,
} from '@briefer/editor'
import EnvBar from '../EnvBar'
import PlusButton from './PlusButton'
import RichTextBlock from './customBlocks/richText'
import SQLBlock from './customBlocks/sql'
import { ApiDocument, UserWorkspaceRole } from '@briefer/database'
import PythonBlock from './customBlocks/python'
import VisualizationBlock from './customBlocks/visualization'
import { DataFrame } from '@briefer/types'
import {
  Bars3CenterLeftIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleStackIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  QueueListIcon,
  CommandLineIcon as CommandLineSmallIcon,
  ArrowUpTrayIcon,
  CalendarIcon,
} from '@heroicons/react/20/solid'
import { ContentSkeleton } from './ContentSkeleton'
import InputBlock from './customBlocks/input'
import FileUploadBlock from './customBlocks/fileUpload'
import ExecIndicator from './ExecIndicator'
import DropdownInputBlock from './customBlocks/dropdownInput'
import DateInputBlock from './customBlocks/dateInput'
import NewTabButton from './NewTabButton'
import useScrollDetection from '@/hooks/useScrollDetection'
import { useEnvironmentStatus } from '@/hooks/useEnvironmentStatus'
import { APIDataSources } from '@/hooks/useDatasources'
import { IProvider } from '@/hooks/useYProvider'
import { widthClasses } from './constants'
import { descend, sortWith } from 'ramda'
import WritebackBlock from './customBlocks/writeback'
import RemoveBlockDashboardConflictDialog from './RemoveBlockDashboardConflictDialog'
import RemoveTabDashboardConflictDialog from './RemoveTabDashboardConflictDialog'
import PivotTableBlock from './customBlocks/pivotTable'

export enum ElementType {
  Block = 'BLOCK',
  BlockGroup = 'BLOCK_GROUP',
}

// The react-dnd package does not export this...
type Identifier = string | symbol

const layoutGetter = (yDoc: Y.Doc) => yDoc.getArray<YBlockGroup>('layout')
const blocksGetter = (yDoc: Y.Doc) => yDoc.getMap<YBlock>('blocks')
const dataframesGetter = (yDoc: Y.Doc) => yDoc.getMap<DataFrame>('dataframes')

const Dropzone = ({
  index,
  isEditable,
  onDropItem,
  onCheckCanDrop,
  onAddBlock,
  writebackEnabled,
}: {
  index: number
  isEditable: boolean
  onDropItem: (
    blockGroupId: string,
    blockId: string,
    targetIndex: number,
    type: Identifier | null
  ) => void
  onCheckCanDrop: (
    id: string,
    index: number,
    type: Identifier | null
  ) => boolean
  onAddBlock: (type: BlockType, index: number) => void
  writebackEnabled: boolean
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: [ElementType.Block, ElementType.BlockGroup],
      drop: (
        { blockGroupId, blockId }: { blockGroupId: string; blockId: string },
        monitor
      ) => onDropItem(blockGroupId, blockId, index, monitor.getItemType()),
      canDrop: ({ blockGroupId }, monitor) =>
        onCheckCanDrop(blockGroupId, index, monitor.getItemType()),
      collect: (monitor) => ({
        isOver: monitor.isOver() ?? false,
        canDrop: monitor.canDrop() ?? false,
      }),
    }),
    [index, updateOrder, onCheckCanDrop, onDropItem]
  )

  const addBlockHandler = useCallback(
    (type: BlockType) => {
      onAddBlock(type, index)
    },
    [onAddBlock, index]
  )

  return (
    <div
      ref={(d) => {
        drop(d)
      }}
      className={clsx('w-full', isOver && canDrop ? 'bg-ceramic-300' : '')}
    >
      <PlusButton
        alwaysVisible={false}
        onAddBlock={addBlockHandler}
        isEditable={isEditable}
        writebackEnabled={writebackEnabled}
      />
    </div>
  )
}

export function getTabIcon(
  blockType: BlockType
): React.ComponentType<React.SVGProps<SVGSVGElement>> {
  switch (blockType) {
    case BlockType.RichText:
      return Bars3CenterLeftIcon
    case BlockType.SQL:
      return CircleStackIcon
    case BlockType.Python:
      return CommandLineSmallIcon
    case BlockType.Visualization:
      return ChartBarIcon
    case BlockType.Input:
      return PencilSquareIcon
    case BlockType.DropdownInput:
      return QueueListIcon
    case BlockType.DateInput:
      return CalendarIcon
    case BlockType.FileUpload:
      return DocumentArrowUpIcon
    case BlockType.DashboardHeader:
      return ExclamationTriangleIcon
    case BlockType.Writeback:
      return ArrowUpTrayIcon
    case BlockType.PivotTable:
      // TODO: PivotTable icon
      return Bars3CenterLeftIcon
  }
}

interface TabProps {
  tabRef: TabRef
  onSwitchActiveTab: (tabId: string) => void
  onReorderTab: (
    blockGroupId: string,
    blockId: string,
    targetId: string,
    side: 'left' | 'right'
  ) => void
  onCheckCanReorderTab: (
    blockGroupId: string,
    blockId: string,
    targetId: string,
    side: 'left' | 'right'
  ) => boolean
  isFirst?: boolean
  isDraggable: boolean
}
function Tab(props: TabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [draggingSide, setDraggingSide] = useState<'left' | 'right'>('left')

  const getDraggingSide = useCallback(
    (monitor: DropTargetMonitor) => {
      const offset = monitor.getClientOffset()
      const buttonPos = buttonRef.current?.getBoundingClientRect()

      // check if dragging to the left or right of the button
      if (offset && buttonPos) {
        const buttonCenter = buttonPos.x + buttonPos.width / 2
        if (offset.x < buttonCenter) {
          return 'left'
        } else {
          return 'right'
        }
      }
    },
    [buttonRef]
  )

  const [{ isDragging }, drag] = useDrag(
    () => ({
      canDrag: props.isDraggable,
      type: ElementType.Block,
      item: () => {
        return {
          blockGroupId: props.tabRef.blockGroupId,
          blockId: props.tabRef.blockId,
          dragSize: Math.ceil(
            buttonRef.current?.getBoundingClientRect().width ?? 0
          ),
        }
      },
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [props.tabRef.blockGroupId, props.tabRef.blockId]
  )

  const [{ isOver, canDrop, dragSize }, drop] = useDrop(
    () => ({
      accept: ElementType.Block,
      drop: (
        {
          blockGroupId,
          blockId,
        }: {
          blockGroupId: string
          blockId: string
          dragSize: number
        },
        monitor
      ) => {
        const side = getDraggingSide(monitor)
        if (!side) {
          return
        }

        props.onReorderTab(blockGroupId, blockId, props.tabRef.blockId, side)
      },
      canDrop: ({ blockId }, monitor) => {
        const side = getDraggingSide(monitor)
        if (!side) {
          return false
        }

        return props.onCheckCanReorderTab(
          props.tabRef.blockGroupId,
          blockId,
          props.tabRef.blockId,
          side
        )
      },
      hover: (_item, monitor) => {
        const side = getDraggingSide(monitor)
        if (side) {
          setDraggingSide(side)
        }
      },
      collect: (monitor) => {
        return {
          isOver: monitor.isOver() ?? false,
          canDrop: monitor.canDrop() ?? false,
          dragSize: monitor.getItem()?.dragSize ?? 0,
        }
      },
    }),

    [props.tabRef.blockGroupId, props.tabRef.blockId]
  )

  useEffect(() => {
    if (!props.isDraggable) {
      return
    }

    drag(buttonRef)
  }, [props.isDraggable, drag, buttonRef])

  const Icon = getTabIcon(props.tabRef.type)

  return (
    <div
      ref={(d) => {
        drop(d)
      }}
      className="h-full flex text-xs"
    >
      {draggingSide === 'left' && isOver && canDrop && (
        <div className={`bg-ceramic-100`} style={{ width: `${dragSize}px` }} />
      )}
      <button
        key={props.tabRef.blockId}
        ref={buttonRef}
        onClick={() => props.onSwitchActiveTab(props.tabRef.blockId)}
        className={clsx(
          'flex gap-x-2 items-center border-l border-r border-t border-gray-200 px-2.5 py-1.5 rounded-t-sm whitespace-nowrap',
          props.tabRef.isCurrent
            ? 'bg-white text-gray-950'
            : 'bg-gray-50 text-gray-400',
          isDragging ? 'opacity-0' : '',
          !props.isFirst ? '-ml-[1px]' : ''
        )}
      >
        <div className="flex items-center gap-x-1">
          <Icon
            className={clsx(
              'h-3 w-3',
              props.tabRef.isCurrent ? 'text-gray-600' : 'text-gray-300'
            )}
          />
          {props.tabRef.title || getPrettyTitle(props.tabRef.type)}{' '}
          {props.tabRef.isHiddenInPublished && (
            <span
              className={clsx(
                'pl-0.5 text-[10px]',
                props.tabRef.isCurrent ? 'text-gray-400' : 'text-gray-300'
              )}
            >
              hidden
            </span>
          )}
        </div>
        <ExecIndicator execStatus={props.tabRef.execStatus} />
      </button>
      {draggingSide === 'right' && isOver && canDrop && (
        <div className={`bg-ceramic-100`} style={{ width: `${dragSize}px` }} />
      )}
    </div>
  )
}

const DraggableTabbedBlock = (props: {
  id: string
  document: ApiDocument
  isEditable: boolean
  isApp: boolean
  onGroup: (
    blockGroupId: string,
    blockId: string,
    targetId: string,
    type: Identifier | null
  ) => void
  onAddGroupedBlock: (
    type: BlockType,
    blockGroupId: string,
    blockId: string,
    position: 'before' | 'after'
  ) => void
  onRemoveBlockGroup: (id: string) => void
  onRemoveBlock: (blockGroupId: string, id: string) => void
  awareness: Awareness
  dataSources: APIDataSources
  dataframes: Y.Map<DataFrame>
  isPublicViewer: boolean
  onDuplicateBlockGroup: (id: string) => void
  onDuplicateBlock: (blockGroupId: string, blockId: string) => void
  yDoc: Y.Doc
  isPDF: boolean
  onSchemaExplorer: (dataSourceId: string | null) => void
}) => {
  const { state: layout } = useYDocState<Y.Array<YBlockGroup>>(
    props.yDoc,
    layoutGetter
  )
  const { state: blocks } = useYDocState<Y.Map<YBlock>>(
    props.yDoc,
    blocksGetter
  )

  const { startedAt: environmentStartedAt } = useEnvironmentStatus(
    props.document.workspaceId
  )

  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      canDrag: props.isEditable && !props.isApp,
      type: ElementType.BlockGroup,
      previewOptions: {
        captureDraggingState: true,
      },
      item: () => ({ blockGroupId: props.id }),
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [props.id]
  )

  const tabRefs = useMemo(
    () =>
      getTabsFromBlockGroupId(layout.value, blocks.value, props.id).filter(
        (t) => (props.isApp ? !t.isHiddenInPublished : true)
      ),
    [props.id, layout, blocks]
  )
  const hasMultipleTabs = tabRefs.length > 1

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: [ElementType.Block, ElementType.BlockGroup],
      drop: (
        {
          blockGroupId: droppedBlockGroupId,
          blockId: droppedBlockId,
        }: { blockGroupId: string; blockId: string },
        monitor
      ) => {
        const droppedType = monitor.getItemType()
        props.onGroup(
          droppedBlockGroupId,
          droppedBlockId,
          props.id,
          droppedType
        )
      },
      canDrop: ({ blockGroupId }) => blockGroupId !== props.id,
      collect: (monitor) => ({
        isOver: monitor.isOver() ?? false,
        canDrop: monitor.canDrop() ?? false,
      }),
    }),
    [props.id, props.onGroup]
  )

  const addGroupedBlock = useCallback(
    (blockId: string, blockType: BlockType, position: 'before' | 'after') => {
      return props.onAddGroupedBlock(blockType, props.id, blockId, position)
    },
    [props.onAddGroupedBlock, props.id]
  )

  const onRun = useCallback(
    <B extends YBlock>(block: B, customCallback?: (block: B) => void) => {
      requestRun(
        block,
        blocks.value,
        layout.value,
        environmentStartedAt,
        false,
        customCallback
      )
    },
    [blocks.value, layout.value, environmentStartedAt]
  )

  const onTry = useCallback(
    (block: YBlock) => {
      requestTrySuggestion(
        block,
        blocks.value,
        layout.value,
        environmentStartedAt
      )
    },
    [blocks.value, layout.value, environmentStartedAt]
  )

  const onFileUploadBlockPythonUsage = useCallback(
    (block: Y.XmlElement<FileUploadBlock>, filename: string, type: string) => {
      const fileExtension =
        type === 'application/json'
          ? 'json'
          : type === 'text/csv'
          ? 'csv'
          : type === 'application/vnd.ms-excel'
          ? 'xls'
          : type ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ? 'xlsx'
          : ''

      const source =
        fileExtension !== ''
          ? `import pandas as pd
df = pd.read_${fileExtension}('${filename}')
df`
          : `file = open('${filename}').read()
file`

      const blockId = addBlockGroupAfterBlock(
        layout.value,
        blocks.value,
        {
          type: BlockType.Python,
          source,
        },
        getBaseAttributes(block).id
      )

      const pythonBlock = blocks.value.get(blockId)
      if (!pythonBlock) {
        return
      }

      requestRun(
        pythonBlock,
        blocks.value,
        layout.value,
        environmentStartedAt,
        false
      )
    },
    [blocks, layout, environmentStartedAt]
  )

  const onFileUploadBlockQueryUsage = useCallback(
    (block: Y.XmlElement<FileUploadBlock>, filename: string) => {
      const table = filename
        // replace `\` with `\\`
        .replace(/\\/g, '\\\\')
        // replace `'` with `''`
        .replace(/'/g, "''")
        // replace `"` with `\"`
        .replace(/"/g, '\\"')

      const extension = filename.split('.').pop()
      let source = `SELECT * FROM '${table}' LIMIT 1000000`
      if (extension === 'xlsx') {
        source = `SELECT * FROM st_read('${table}') LIMIT 1000000`
      }

      const blockId = addBlockGroupAfterBlock(
        layout.value,
        blocks.value,
        {
          type: BlockType.SQL,
          dataSourceId: null,
          isFileDataSource: true,
          source,
        },
        getBaseAttributes(block).id
      )

      const sqlBlock = blocks.value.get(blockId)
      if (!sqlBlock) {
        return
      }

      requestRun(
        sqlBlock,
        blocks.value,
        layout.value,
        environmentStartedAt,
        false
      )
    },
    []
  )

  const onToggleIsBlockHiddenInPublished = useCallback(
    (blockId: string) => {
      const blockGroup = layout.value
        .toArray()
        .find((bg) => bg.getAttribute('id') === props.id)
      if (!blockGroup) {
        return
      }

      toggleIsBlockHiddenInPublished(blockGroup, blockId)
    },
    [layout, props.id]
  )

  const currentBlockId = useMemo(
    () => getCurrentTabId(layout.value, props.id, blocks.value, props.isApp),
    [layout, blocks, props.isApp]
  )

  const nodes = useMemo(() => {
    if (tabRefs.length === 0) {
      return <div>Block group is empty</div>
    }

    return tabRefs.map((tab) => {
      const block = blocks.value.get(tab.blockId)
      if (!block) {
        return <div>Block not found</div>
      }

      const jsx = switchBlockType(block, {
        onRichText: (block) => (
          <RichTextBlock
            block={block}
            isEditable={props.isEditable}
            belongsToMultiTabGroup={hasMultipleTabs}
            dragPreview={hasMultipleTabs ? null : dragPreview}
            isDashboard={false}
          />
        ),
        onSQL: (block) => (
          <SQLBlock
            block={block}
            layout={layout.value}
            blocks={blocks.value}
            isPublicMode={props.isPublicViewer}
            isEditable={props.isEditable}
            document={props.document}
            dataSources={props.dataSources}
            dragPreview={hasMultipleTabs ? null : dragPreview}
            onRun={onRun}
            onTry={onTry}
            dashboardMode="none"
            hasMultipleTabs={hasMultipleTabs}
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
            onSchemaExplorer={props.onSchemaExplorer}
          />
        ),
        onPython: (block) => (
          <PythonBlock
            isPublicMode={props.isPublicViewer}
            block={block}
            isEditable={props.isEditable}
            document={props.document}
            dragPreview={hasMultipleTabs ? null : dragPreview}
            onRun={onRun}
            onTry={onTry}
            isPDF={props.isPDF}
            dashboardPlace={null}
            hasMultipleTabs={hasMultipleTabs}
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
          />
        ),
        onVisualization: (block) => (
          <VisualizationBlock
            isPublicMode={props.isPublicViewer}
            isEditable={props.isEditable}
            document={props.document}
            onAddGroupedBlock={addGroupedBlock}
            block={block}
            dataframes={props.dataframes}
            dragPreview={hasMultipleTabs ? null : dragPreview}
            onRun={onRun}
            isDashboard={false}
            hasMultipleTabs={hasMultipleTabs}
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
          />
        ),
        onInput: (block) => (
          <InputBlock
            block={block}
            blocks={blocks.value}
            dragPreview={dragPreview}
            belongsToMultiTabGroup={hasMultipleTabs}
            isEditable={props.isEditable}
            isApp={props.isApp}
            onRun={onRun}
            isDashboard={false}
          />
        ),
        onDropdownInput: (block) => (
          <DropdownInputBlock
            block={block}
            blocks={blocks.value}
            dragPreview={dragPreview}
            belongsToMultiTabGroup={hasMultipleTabs}
            isEditable={props.isEditable}
            isApp={props.isApp}
            dataframes={props.dataframes}
            onRun={onRun}
            isDashboard={false}
          />
        ),
        onDateInput: (block) => (
          <DateInputBlock
            block={block}
            blocks={blocks.value}
            dragPreview={dragPreview}
            belongsToMultiTabGroup={hasMultipleTabs}
            isEditable={props.isEditable}
            isApp={props.isApp}
            onRun={onRun}
            isDashboard={false}
          />
        ),
        onFileUpload: (block) => (
          <FileUploadBlock
            block={block}
            workspaceId={props.document.workspaceId}
            documentId={props.document.id}
            isEditable={props.isEditable}
            isPublicViewer={props.isPublicViewer}
            dragPreview={dragPreview}
            hasMultipleTabs={hasMultipleTabs}
            onPythonUsage={(filename, type) =>
              onFileUploadBlockPythonUsage(block, filename, type)
            }
            onQueryUsage={(filename) =>
              onFileUploadBlockQueryUsage(block, filename)
            }
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
          />
        ),
        onDashboardHeader: () => null,
        onWriteback: (block) => (
          <WritebackBlock
            workspaceId={props.document.workspaceId}
            block={block}
            hasMultipleTabs={hasMultipleTabs}
            isEditable={props.isEditable}
            dragPreview={dragPreview}
            dataSources={props.dataSources}
            dataframes={props.dataframes}
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
          />
        ),
        onPivotTable: (block) => (
          <PivotTableBlock
            workspaceId={props.document.workspaceId}
            block={block}
            blocks={blocks.value}
            hasMultipleTabs={hasMultipleTabs}
            isEditable={props.isEditable}
            onRun={onRun}
            onAddGroupedBlock={addGroupedBlock}
            dragPreview={dragPreview}
            dataframes={props.dataframes}
            isBlockHiddenInPublished={tab.isHiddenInPublished}
            onToggleIsBlockHiddenInPublished={onToggleIsBlockHiddenInPublished}
            dashboardMode="none"
          />
        ),
      })

      return (
        <div
          key={tab.blockId}
          className={
            tab.blockId === currentBlockId || props.isPDF
              ? ''
              : 'h-0 overflow-hidden'
          }
        >
          {jsx}
        </div>
      )
    })
  }, [
    props.id,
    layout,
    blocks,
    props.isEditable,
    props.dataSources,
    onRun,
    props.dataframes,
    props.isPDF,
    onFileUploadBlockPythonUsage,
    onFileUploadBlockQueryUsage,
    props.isApp,
    tabRefs,
    hasMultipleTabs,
    currentBlockId,
    props.onSchemaExplorer,
  ])

  const onSwitchActiveTab = useCallback(
    (tabId: string) => {
      props.yDoc.transact(() => {
        switchActiveTab(layout.value, props.id, tabId)
      })
    },
    [props.yDoc, layout.value, props.id]
  )

  const onReorderTab = useCallback(
    (
      blockGroupId: string,
      blockId: string,
      targetId: string,
      side: 'left' | 'right'
    ) => {
      props.yDoc.transact(() => {
        return reorderTab(layout.value, blockGroupId, blockId, targetId, side)
      })
    },
    [props.yDoc, layout]
  )

  const onCheckCanReorderTab = useCallback(
    (
      blockGroupId: string,
      blockId: string,
      targetId: string,
      side: 'left' | 'right'
    ) => {
      return canReorderTab(layout.value, blockGroupId, blockId, targetId, side)
    },
    [layout]
  )

  const onDeleteCurrentTab = useCallback(() => {
    if (!currentBlockId) {
      return
    }

    props.onRemoveBlock(props.id, currentBlockId)
  }, [currentBlockId, props.id, props.onRemoveBlock])

  const runAllTabs = useCallback(() => {
    tabRefs.forEach((tab, i) => {
      const block = blocks.value.get(tab.blockId)
      if (!block) {
        return
      }

      if (!execStatusIsDisabled(getExecStatus(block, blocks.value))) {
        requestRun(
          block,
          blocks.value,
          layout.value,
          environmentStartedAt,
          i > 0
        )
      }
    })
  }, [blocks, layout, tabRefs, environmentStartedAt])

  const popupContainerRef = useRef<HTMLDivElement>(null)

  const onDuplicateBlockGroup = useCallback(() => {
    props.onDuplicateBlockGroup(props.id)
  }, [props.id, props.onDuplicateBlockGroup])

  const onDuplicateCurrentTab = useCallback(() => {
    if (!currentBlockId) {
      return
    }

    props.onDuplicateBlock(props.id, currentBlockId)
  }, [currentBlockId, props.id, props.onDuplicateBlock])

  const onRemoveBlockGroup = useCallback(() => {
    props.onRemoveBlockGroup(props.id)
  }, [props.id, props.onRemoveBlockGroup])

  const tabContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (hasMultipleTabs) {
      dragPreview(tabContainerRef.current)
    }
  }, [hasMultipleTabs, dragPreview, tabContainerRef])

  const {
    isScrollable,
    isScrolledAllTheWayLeft,
    isScrolledAllTheWayRight,
    onClickScrollLeft,
    onClickScrollRight,
  } = useScrollDetection(tabContainerRef)

  const onHideAllTabs = useCallback(() => {
    props.yDoc.transact(() => {
      const blockGroup = getBlockGroup(layout.value, props.id)
      if (!blockGroup) {
        return
      }

      const tabs = getTabsFromBlockGroup(blockGroup, blocks.value)
      tabs.forEach((tab) => {
        const isHidden = tab.isHiddenInPublished
        if (!isHidden) {
          toggleIsBlockHiddenInPublished(blockGroup, tab.blockId)
        }
      })
    })
  }, [layout, blocks, props.id])

  return (
    <div className="flex group/wrapper gap-x-1 relative">
      <div
        // this calc is here because CSS sucks
        className={clsx(
          'flex flex-col gap-y-1 absolute -translate-x-[calc(100%+4px)] h-full',
          {
            hidden: !props.isEditable || props.isApp,
          }
        )}
        ref={(d) => {
          drag(d)
        }}
      >
        <DragHandle
          isDragging={isDragging}
          onRunAllTabs={hasMultipleTabs ? runAllTabs : null}
          onDuplicateTab={hasMultipleTabs ? onDuplicateCurrentTab : null}
          onDuplicateBlock={onDuplicateBlockGroup}
          onDeleteTab={hasMultipleTabs ? onDeleteCurrentTab : null}
          onDeleteBlock={onRemoveBlockGroup}
          targetRef={popupContainerRef}
          onHideAllTabs={onHideAllTabs}
        />
      </div>
      <div className="flex-grow max-w-full">
        {hasMultipleTabs && !props.isPDF && (
          <div className="print:hidden flex">
            <div
              className="flex max-w-full overflow-x-scroll no-scrollbar scroll-smooth"
              ref={tabContainerRef}
            >
              {isScrollable && !isScrolledAllTheWayLeft && (
                <button
                  className="sticky left-0 h-full bg-white border-t border-r border-l border-gray-200"
                  onClick={onClickScrollLeft}
                >
                  <ChevronLeftIcon className="h-5 w-5 text-gray-400" />
                </button>
              )}
              {tabRefs.map((tabRef, i) => (
                <Tab
                  key={tabRef.blockId}
                  tabRef={tabRef}
                  isFirst={i === 0}
                  onSwitchActiveTab={onSwitchActiveTab}
                  onReorderTab={onReorderTab}
                  onCheckCanReorderTab={onCheckCanReorderTab}
                  isDraggable={hasMultipleTabs && !props.isApp}
                />
              ))}
              {isScrollable && !isScrolledAllTheWayRight && (
                <button
                  className="sticky right-0 h-full bg-white border-t border-r border-l border-gray-200"
                  onClick={onClickScrollRight}
                >
                  <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                </button>
              )}
            </div>
            {!props.isApp && (
              <NewTabButton
                layout={layout.value}
                blocks={blocks.value}
                blockGroupId={props.id}
                lastBlockId={tabRefs[tabRefs.length - 1].blockId}
                dataSources={props.dataSources}
              />
            )}
          </div>
        )}
        <div
          className="relative"
          ref={(d) => {
            drop(d)
          }}
        >
          <div
            className={clsx(
              'absolute top-0 left-0 h-full w-full z-30 opacity-50 pointer-events-none',
              isOver && canDrop
                ? 'bg-ceramic-100'
                : isDragging
                ? 'opacity-50'
                : ''
            )}
          />
          {props.isPDF ? (
            <div className="flex flex-col gap-y-10">{nodes}</div>
          ) : (
            nodes
          )}
        </div>
      </div>
    </div>
  )
}

const V2EditorRow = (props: {
  index: number
  document: ApiDocument
  yDoc: Y.Doc
  blockId: string
  isEditable: boolean
  isApp: boolean
  onDropItem: (
    blockGroupId: string,
    blockId: string,
    targetIndex: number,
    type: Identifier | null
  ) => void
  onCheckCanDrop: (
    id: string,
    index: number,
    type: Identifier | null
  ) => boolean
  onRemoveBlock: (blockGroupId: string, id: string) => void
  onRemoveBlockGroup: (id: string) => void
  onGroup: (
    blockGroupId: string,
    blockId: string,
    targetId: string,
    type: Identifier | null
  ) => void
  onAddBlock: (type: BlockType, index: number) => void
  onAddGroupedBlock: (
    type: BlockType,
    blockGroupId: string,
    blockId: string,
    position: 'before' | 'after'
  ) => void
  awareness: Awareness
  dataSources: APIDataSources
  dataframes: Y.Map<DataFrame>
  isPublicViewer: boolean
  onDuplicateBlock: (blockGroupId: string, blockId: string) => void
  onDuplicateBlockGroup: (id: string) => void
  isPDF: boolean
  writebackEnabled: boolean
  onSchemaExplorer: (dataSourceId: string | null) => void
}) => {
  return (
    <div>
      {props.index === 0 && (
        <Dropzone
          index={props.index}
          isEditable={props.isEditable && !props.isApp}
          onAddBlock={props.onAddBlock}
          onDropItem={props.onDropItem}
          onCheckCanDrop={props.onCheckCanDrop}
          writebackEnabled={props.writebackEnabled}
        />
      )}
      <DraggableTabbedBlock
        id={props.blockId}
        document={props.document}
        isEditable={props.isEditable}
        isApp={props.isApp}
        onAddGroupedBlock={props.onAddGroupedBlock}
        onRemoveBlock={props.onRemoveBlock}
        onRemoveBlockGroup={props.onRemoveBlockGroup}
        onGroup={props.onGroup}
        awareness={props.awareness}
        dataSources={props.dataSources}
        dataframes={props.dataframes}
        isPublicViewer={props.isPublicViewer}
        onDuplicateBlock={props.onDuplicateBlock}
        onDuplicateBlockGroup={props.onDuplicateBlockGroup}
        yDoc={props.yDoc}
        isPDF={props.isPDF}
        onSchemaExplorer={props.onSchemaExplorer}
      />
      <Dropzone
        index={props.index + 1}
        isEditable={props.isEditable && !props.isApp}
        onAddBlock={props.onAddBlock}
        onDropItem={props.onDropItem}
        onCheckCanDrop={props.onCheckCanDrop}
        writebackEnabled={props.writebackEnabled}
      />
    </div>
  )
}

type V2EditorProps = {
  isPublicViewer: boolean
  document: ApiDocument
  dataSources: APIDataSources
  isDeleted: boolean
  onRestoreDocument: () => void
  isEditable: boolean
  isPDF: boolean
  isApp: boolean
  role: UserWorkspaceRole
  isFullScreen: boolean
  yDoc: Y.Doc
  provider: IProvider
  isSyncing: boolean
  onOpenFiles: () => void
  onSchemaExplorer: (dataSourceId: string | null) => void
}

const V2Editor = (props: V2EditorProps) => {
  const { state: layout } = useYDocState<Y.Array<YBlockGroup>>(
    props.yDoc,
    layoutGetter
  )
  const { state: blocks } = useYDocState<Y.Map<YBlock>>(
    props.yDoc,
    blocksGetter
  )
  const { state: dataframes } = useYDocState<Y.Map<DataFrame>>(
    props.yDoc,
    dataframesGetter
  )

  const editorWrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!props.isSyncing) {
      editorWrapperRef.current?.setAttribute('data-editor-ready', 'true')
    }
  }, [editorWrapperRef, props.isSyncing])

  const newSQLDatasourceId = useMemo(
    () =>
      sortWith(
        [
          // put demo data source last
          descend((d) => (d.dataSource.data.isDemo ? 0 : 1)),
          // put newer data sources first
          descend((d) => d.dataSource.data.createdAt),
        ],
        props.dataSources
      )[0]?.dataSource.data.id,
    [props.dataSources]
  )

  const onAddBlock = useCallback(
    (type: BlockType, index: number) => {
      props.yDoc.transact(() => {
        switch (type) {
          case BlockType.SQL:
            addBlockGroup(
              layout.value,
              blocks.value,
              {
                type,
                dataSourceId: newSQLDatasourceId,
                isFileDataSource: false,
              },
              index
            )
            break
          case BlockType.Visualization:
            addBlockGroup(
              layout.value,
              blocks.value,
              { type, dataframeName: null },
              index
            )
            break
          case BlockType.DashboardHeader:
            break
          default:
            addBlockGroup(layout.value, blocks.value, { type }, index)
            break
        }
      })
    },
    [props.yDoc, layout, blocks, props.dataSources, newSQLDatasourceId]
  )

  const onAddGroupedBlock = useCallback(
    (
      type: BlockType,
      blockGroupId: string,
      blockId: string,
      position: 'before' | 'after'
    ) => {
      props.yDoc.transact(() => {
        switch (type) {
          case BlockType.SQL:
            addGroupedBlock(
              layout.value,
              blocks.value,
              blockGroupId,
              blockId,
              {
                type,
                dataSourceId: newSQLDatasourceId,
                isFileDataSource: false,
              },
              position
            )
            break
          case BlockType.Visualization:
            addGroupedBlock(
              layout.value,
              blocks.value,
              blockGroupId,
              blockId,
              { type, dataframeName: null },
              position
            )
            break
          case BlockType.DashboardHeader:
            break
          default:
            addGroupedBlock(
              layout.value,
              blocks.value,
              blockGroupId,
              blockId,
              { type },
              position
            )
            break
        }
      })
    },
    [props.yDoc, layout, blocks, props.dataSources, newSQLDatasourceId]
  )

  const onDropItem = useCallback(
    (
      blockGroupId: string,
      blockId: string,
      targetIndex: number,
      type: Identifier | null
    ) => {
      props.yDoc.transact(() => {
        if (type === ElementType.BlockGroup) {
          updateOrder(layout.value, blockGroupId, targetIndex)
        } else if (type === ElementType.Block) {
          ungroupTab(layout.value, blockGroupId, blockId, targetIndex)
        }
      })
    },
    [props.yDoc, layout]
  )

  const onGroup = useCallback(
    (
      blockGroupId: string,
      blockId: string,
      targetId: string,
      type: Identifier | null
    ) => {
      props.yDoc.transact(() => {
        if (type === ElementType.Block) {
          groupBlocks(layout.value, blockGroupId, blockId, targetId)
        } else if (type === ElementType.BlockGroup) {
          groupBlockGroups(layout.value, blockGroupId, targetId)
        }
      })
    },
    [props.yDoc, layout]
  )

  const onCheckCanDrop = useCallback(
    (blockGroupId: string, index: number, type: Identifier | null) => {
      if (type === ElementType.Block) {
        return checkCanDropBlock(layout.value, blockGroupId, index)
      } else if (type === ElementType.BlockGroup) {
        return checkCanDropBlockGroup(layout.value, blockGroupId, index)
      }
      return false
    },
    [layout]
  )

  const [removeBlockGroupDialog, setRemoveBlockGroupDialog] =
    useState<RemoveBlockGroupResult | null>(null)
  const onRemoveBlockGroup = useCallback(
    (blockId: string) => {
      const result = removeBlockGroup(props.yDoc, blockId, false)
      if (result._tag !== 'success') {
        setRemoveBlockGroupDialog(result)
      }
    },
    [props.yDoc, blocks, setRemoveBlockGroupDialog]
  )

  const [removeBlockDialog, setRemoveBlockDialog] =
    useState<RemoveBlockDashboardConflictResult | null>(null)
  const onRemoveBlock = useCallback(
    (blockGroupId: string, blockId: string) => {
      const result = removeBlock(props.yDoc, blockGroupId, blockId, false)
      if (result._tag !== 'success') {
        setRemoveBlockDialog(result)
      }
    },
    [props.yDoc, blocks, setRemoveBlockDialog]
  )

  const onDuplicateBlockGroup = useCallback(
    (blockGroupId: string) => {
      props.yDoc.transact(() => {
        duplicateBlockGroup(layout.value, blocks.value, blockGroupId)
      })
    },
    [layout, blocks]
  )

  const onDuplicateBlock = useCallback(
    (blockGroupId: string, blockId: string) => {
      props.yDoc.transact(() => {
        duplicateTab(layout.value, blocks.value, blockGroupId, blockId)
      })
    },
    [layout, blocks]
  )

  const hasWriteback = useMemo(
    () =>
      props.dataSources.some(
        (ds) =>
          ds.dataSource.type === 'psql' || ds.dataSource.type === 'bigquery'
      ),
    [props.dataSources]
  )

  const domBlocks = useMemo(() => {
    return layout.value.toArray().map((blockGroup, i) => {
      const blockId = blockGroup.getAttribute('id')
      const tabs = getTabsFromBlockGroup(blockGroup, blocks.value).filter((t) =>
        props.isApp ? !t.isHiddenInPublished : true
      )
      if (!blockId || tabs.length === 0) {
        if (i === 0) {
          return <div key={i} className="h-10" />
        }

        return null
      }

      return (
        <V2EditorRow
          yDoc={props.yDoc}
          document={props.document}
          key={i}
          blockId={blockId}
          index={i}
          isEditable={props.isEditable}
          isApp={props.isApp}
          onAddBlock={onAddBlock}
          onAddGroupedBlock={onAddGroupedBlock}
          onDropItem={onDropItem}
          onCheckCanDrop={onCheckCanDrop}
          onRemoveBlockGroup={onRemoveBlockGroup}
          onRemoveBlock={onRemoveBlock}
          onGroup={onGroup}
          awareness={props.provider.awareness}
          dataSources={props.dataSources}
          dataframes={dataframes.value}
          isPublicViewer={props.isPublicViewer}
          onDuplicateBlock={onDuplicateBlock}
          onDuplicateBlockGroup={onDuplicateBlockGroup}
          isPDF={props.isPDF}
          writebackEnabled={true}
          onSchemaExplorer={props.onSchemaExplorer}
        />
      )
    })
  }, [
    props.document,
    props.yDoc,
    layout,
    dataframes,
    onDropItem,
    onCheckCanDrop,
    onRemoveBlockGroup,
    onRemoveBlock,
    onGroup,
    onAddBlock,
    props.isEditable,
    props.isPDF,
    props.isApp,
    props.onSchemaExplorer,
  ])

  const addBlockToBottom = useCallback(
    (type: BlockType) => {
      onAddBlock(type, layout.value.length)
    },
    [onAddBlock, layout]
  )

  const lastUpdatedAt = useLastUpdatedAt(props.yDoc)

  return (
    <div className="editor-v2 flex flex-col flex-grow justify-center font-primary subpixel-antialiased h-full w-full">
      {props.isDeleted && (
        <div className="bg-yellow-50 py-6 border-b border-yellow-200">
          <div className="flex justify-center">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm leading-5 text-yellow-700">
                This document is deleted.{' '}
                <button
                  className="hover:underline text-primary-600 hover:text-primary-800 font-medium"
                  onClick={props.onRestoreDocument}
                >
                  Restore.
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className={clsx(
          'flex h-full justify-center',
          props.isFullScreen ? 'px-20' : 'sm:px-0 px-4',
          {
            'overflow-y-auto overflow-x-hidden': !props.isPDF,
          }
        )}
      >
        <div
          id="editor-wrapper"
          ref={editorWrapperRef}
          className={clsx(
            'flex-grow h-full py-2',
            props.isFullScreen ? 'w-full' : widthClasses
          )}
        >
          <div className={!props.isPDF ? 'pt-12' : ''}>
            <Title
              content={props.yDoc.getXmlFragment('title')}
              isLoading={props.isSyncing}
              isEditable={props.isEditable && !props.isApp}
              isPDF={props.isPDF}
            />
          </div>

          <ContentSkeleton visible={props.isSyncing} />

          {!props.isSyncing && (
            <>
              {domBlocks}

              {domBlocks.length === 0 && (
                <div className="w-full">
                  <PlusButton
                    alwaysVisible
                    onAddBlock={addBlockToBottom}
                    isEditable={props.isEditable}
                    writebackEnabled={hasWriteback}
                  />
                </div>
              )}
            </>
          )}

          {!props.isPDF && <div className="pb-72" />}
        </div>
      </div>
      {!props.isPublicViewer && !props.isPDF && (
        <EnvBar
          onOpenFiles={props.onOpenFiles}
          publishedAt={props.isApp ? props.document.publishedAt : null}
          lastUpdatedAt={lastUpdatedAt}
        />
      )}
      <RemoveBlockDashboardConflictDialog
        yDoc={props.yDoc}
        state={
          removeBlockGroupDialog?._tag === 'dashboard-conflict'
            ? removeBlockGroupDialog
            : null
        }
        onClose={() => setRemoveBlockGroupDialog(null)}
      />
      <RemoveTabDashboardConflictDialog
        yDoc={props.yDoc}
        state={
          removeBlockDialog?._tag === 'dashboard-conflict'
            ? removeBlockDialog
            : null
        }
        onClose={() => setRemoveBlockDialog(null)}
      />
    </div>
  )
}

export default V2Editor
