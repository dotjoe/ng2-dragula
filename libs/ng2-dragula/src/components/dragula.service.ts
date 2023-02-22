import { Injectable, Optional } from '@angular/core';
import { Group } from '../Group';
import { DragulaOptions } from '../DragulaOptions';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { EventTypes, AllEvents } from '../EventTypes';
import { DrakeFactory } from '../DrakeFactory';

type FilterProjector<T extends { name: string; }> = (name: string, args: any) => T;
type Dispatch = { event: EventTypes; name: string; args: any[]; };

const filterEvent = <T extends { name: string; source?: any; target?: any; sourceModel?: any; targetModel?: any; }>(
  eventType: EventTypes,
  filterDragType: string | undefined,
  projector: FilterProjector<T>
) => (input: Observable<Dispatch>): Observable<T> => {
  return input.pipe(
    filter(({ event, name }) => {
      return event === eventType
          && (filterDragType === undefined || name === filterDragType);
    }),
    map(({ name, args }) => projector(name, args))
  );
};

const elContainerSourceProjector =
  (name: string, [el, container, source]: [Element, Element, Element]) =>
    ({ name, el, container, source });

@Injectable({
  providedIn: 'root'
})
export class DragulaService {
  private groups: { [k: string]: Group } = {};
  private dispatch$ = new Subject<Dispatch>();
  private elContainerSource =
    (eventType: EventTypes) =>
      (groupName?: string) =>
        this.dispatch$.pipe(
          filterEvent(eventType, groupName, elContainerSourceProjector)
        );
  /* https://github.com/bevacqua/dragula#drakeon-events */
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public cancel = this.elContainerSource(EventTypes.Cancel);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public remove = this.elContainerSource(EventTypes.Remove);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public shadow = this.elContainerSource(EventTypes.Shadow);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public over = this.elContainerSource(EventTypes.Over);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public out = this.elContainerSource(EventTypes.Out);

  public drag = (groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.Drag,
      groupName,
      (name, [el, source]: [Element, Element]) => ({ name, el, source })
    )
  );

  public dragend = (groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.DragEnd,
      groupName,
      (name, [el]: [Element]) => ({ name, el })
    )
  );

  public drop = (groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.Drop,
      groupName,
      (name, [
        el, target, source, sibling
      ]: [Element, Element, Element, Element]) => {
        return { name, el, target, source, sibling };
      })
  );

  public cloned = (groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.Cloned,
      groupName,
      (name, [
        clone, original, cloneType
      ]: [Element, Element, 'mirror' | 'copy']) => {
        return { name, clone, original, cloneType };
      })
  );

  public dropModel = <T = any>(groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.DropModel,
      groupName,
      (name, [
        el, target, source, sibling, item, sourceModel, targetModel, sourceIndex, targetIndex
      ]: [Element, Element, Element, Element, T, T[], T[], number, number]) => {
        return { name, el, target, source, sibling, item, sourceModel, targetModel, sourceIndex, targetIndex };
      })
  );

  public removeModel = <T = any>(groupName?: string) => this.dispatch$.pipe(
    filterEvent(
      EventTypes.RemoveModel,
      groupName,
      (name, [
        el, container, source, item, sourceModel, sourceIndex
      ]: [Element, Element, Element, T, T[], number]) => {
        return { name, el, container, source, item, sourceModel, sourceIndex };
      }
    )
  );

  constructor (@Optional() private drakeFactory: DrakeFactory) {
    if (this.drakeFactory === null || this.drakeFactory === undefined) {
      this.drakeFactory = new DrakeFactory();
    }
  }

  /** Public mainly for testing purposes. Prefer `createGroup()`. */
  public add(group: Group): Group {
    const existingGroup = this.find(group.name);
    if (existingGroup) {
      throw new Error('Group named: "' + group.name + '" already exists.');
    }
    this.groups[group.name] = group;
    this.handleModels(group);
    this.setupEvents(group);
    return group;
  }

  public find(name: string): Group {
    return this.groups[name];
  }

  public destroy(name: string): void {
    const group = this.find(name);
    if (!group) {
      return;
    }
    group.drake && group.drake.destroy();
    delete this.groups[name];
  }

  /**
   * Creates a group with the specified name and options.
   *
   * Note: formerly known as `setOptions`
   */
  public createGroup<T = any>(name: string, options: DragulaOptions<T>): Group {
    return this.add(new Group(
      name,
      this.drakeFactory.build([], options),
      options
    ));
  }

  private handleModels({ name, drake, options }: Group): void {
    let dragElm: any;
    let dragModel: any;
    let dragIndex: number;
    let dropIndex: number;
    drake.on('dragend', (el:any) => {
      this.setDragIndex(dragModel, -1);
    });
    drake.on('cancel', (el:any, source:any) => {
      if (this.isVirtualizedDrag(dragModel)) {
        this.removeElement(el); // element must be removed for ngFor to apply correctly
      }
    });
    drake.on('remove', (el: any, container: any, source: any) => {
      if (!drake.models) {
        return;
      }
      let sourceModel = drake.models[drake.containers.indexOf(source)];
      if (sourceModel.slice) {
       sourceModel = sourceModel.slice(0); // clone it
      }
      const item = sourceModel.splice(dragIndex, 1)[0];
      this.dispatch$.next({
        event: EventTypes.RemoveModel,
        name,
        args: [ el, container, source, item, sourceModel, dragIndex ]
      });
    });
    drake.on('drag', (el: any, source: any) => {
      if (!drake.models) {
        return;
      }
      dragElm = el;
      dragIndex = this.domIndexOf(el, source, drake);
      dragModel = drake.models[drake.containers.indexOf(source)];
      this.setDragIndex(dragModel, dragIndex);
    });
    drake.on('drop', (dropElm: any, target: Element, source: Element, sibling?: Element) => {
      if (!drake.models || !target) {
        return;
      }
      dropIndex = this.domIndexOf(dropElm, target, drake);
      let sourceModel = drake.models[drake.containers.indexOf(source)];
      let targetModel = drake.models[drake.containers.indexOf(target)];
      let item: any;
      if (target === source) {
        if (this.isVirtualizedDrag(sourceModel)) {
          this.removeElement(dropElm); // element must be removed for ngFor to apply correctly
        }
        if (sourceModel.slice) {
          sourceModel = sourceModel.slice(0);
        }
        item = sourceModel.splice(dragIndex, 1)[0];
        sourceModel.splice(dropIndex, 0, item);
        // this was true before we cloned and updated sourceModel,
        // but targetModel still has the old value
        targetModel = sourceModel;
      } else {
        const isCopying = dragElm !== dropElm;
        item = this.getItem(sourceModel, dragIndex);
        
        if (isCopying) {
          if (!options.copyItem) {
            throw new Error("If you have enabled `copy` on a group, you must provide a `copyItem` function.");
          };
          item = options.copyItem(item);
        }

        if (!isCopying) {
          if (sourceModel.slice) {
            sourceModel = sourceModel.slice(0);
          }
          sourceModel.splice(dragIndex, 1);
        }

        if (targetModel.slice) {
          targetModel = targetModel.slice(0);
        }

        targetModel.splice(dropIndex, 0, item);

        this.removeElement(dropElm); // element must be removed for ngFor to apply correctly
      }
      this.dispatch$.next({
        event: EventTypes.DropModel,
        name,
        args: [ dropElm, target, source, sibling, item, sourceModel, targetModel, dragIndex, dropIndex ]
      });
    });
  }

  private setupEvents(group: Group): void {
    if (group.initEvents) {
      return;
    }
    group.initEvents = true;
    const name = group.name;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that: any = this;
    const emitter = (event: EventTypes) => {
      group.drake.on(event, (...args: any[]) => {
        this.dispatch$.next({ event, name, args });
      });
    };
    AllEvents.forEach(emitter);
  }

  private getItem(model: any | any[], index: number): any {
    return this.isFormArrayLike(model) ? model.at(index) : model[index];
  }

  private isFormArrayLike(model: any | any[]): boolean {
    return !!model.at && !!model.insert && !!model.removeAt;
  }

  private domIndexOf(child: any, parent: any, drake: any): any {
    if (!parent) {
      return;
    }

    const domIndex = Array.prototype.indexOf.call(parent.children, child);

    //our DOM elements might be virtualized so we need to get actual index from the model which will track it's offset
    const model = drake.models[drake.containers.indexOf(parent)];
    if (model && model.translateDomIndex) {
      return model.translateDomIndex(domIndex);
    }       

    return domIndex;
  }

  /**
   * @param model Must check for a virtual drag so we know to remove the dropElement (so we don't orphan it in the ngFor)
   */
  private isVirtualizedDrag(model: any) {
    return model && model.virtualizedDrag;
  }

  /**
   * Let the model know about the currently dragged index so it can update it's virtualizedDrag property.
   * @param model 
   * @param index 
   */
  private setDragIndex(model: any, index: number) {
    if (model && model.setDragIndex) {
      model.setDragIndex(index);
    }
  }

  private removeElement(el: Element) {
    try {
      el.parentNode && el.parentNode.removeChild(el);
    // eslint-disable-next-line no-empty
    } catch (e) {}
  }
}
