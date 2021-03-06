import { dragula } from './dragula.class';
import { Injectable, EventEmitter } from '@angular/core';

@Injectable()
export class DragulaService {
  public cancel: EventEmitter<any> = new EventEmitter();
  public cloned: EventEmitter<any> = new EventEmitter();
  public drag: EventEmitter<any> = new EventEmitter();
  public dragend: EventEmitter<any> = new EventEmitter();
  public drop: EventEmitter<any> = new EventEmitter();
  public out: EventEmitter<any> = new EventEmitter();
  public over: EventEmitter<any> = new EventEmitter();
  public remove: EventEmitter<any> = new EventEmitter();
  public shadow: EventEmitter<any> = new EventEmitter();
  public dropModel: EventEmitter<any> = new EventEmitter();
  public removeModel: EventEmitter<any> = new EventEmitter();
  private events: string[] = [
    'cancel', 'cloned', 'drag', 'dragend', 'drop', 'out', 'over',
    'remove', 'shadow', 'dropModel', 'removeModel'
  ];
  private bags: any[] = [];

  public add(name: string, drake: any): any {
    let bag = this.find(name);
    if (bag) {
      throw new Error('Bag named: "' + name + '" already exists.');
    }
    bag = {name, drake};
    this.bags.push(bag);
    if (drake.models) { // models to sync with (must have same structure as containers)
      this.handleModels(name, drake);
    }
    if (!bag.initEvents) {
      this.setupEvents(bag);
    }
    return bag;
  }

  public find(name: string): any {
    for (let bag of this.bags) {
      if (bag.name === name) {
        return bag;
      }
    }
  }

  public destroy(name: string): void {
    let bag = this.find(name);
    let i = this.bags.indexOf(bag);
    this.bags.splice(i, 1);
    bag.drake.destroy();
  }

  public setOptions(name: string, options: any): void {
    let bag = this.add(name, dragula(options));
    this.handleModels(name, bag.drake);
  }

  private handleModels(name: string, drake: any): void {
    let dragElm: any;
    let dragIndex: number;
    let dragModel: any;
    let dropIndex: number;
    let sourceModel: any;

    drake.on('dragend', (el:any) => {
      this.setDragIndex(dragModel, -1);
    });
    drake.on('cancel', (el:any, source:any) => {
      if (this.isVirtualizedDrag(dragModel)) {
        this.removeElement(el); // element must be removed for ngFor to apply correctly
      }
    });
    drake.on('remove', (el: any, source: any) => {
      if (!drake.models) {
        return;
      }
      sourceModel = drake.models[drake.containers.indexOf(source)];
      this.splice(sourceModel, dragIndex, 1);
      // console.log('REMOVE');
      // console.log(sourceModel);
      this.removeModel.emit([name, el, source]);
    });
    drake.on('drag', (el: any, source: any) => {
      dragElm = el;
      dragIndex = this.domIndexOf(el, source, drake);
      dragModel = drake.models[drake.containers.indexOf(source)];
      this.setDragIndex(dragModel, dragIndex);
    });
    drake.on('drop', (dropElm: any, target: any, source: any) => {
      if (!drake.models || !target) {
        return;
      }
      dropIndex = this.domIndexOf(dropElm, target, drake);
      sourceModel = drake.models[drake.containers.indexOf(source)];
      // console.log('DROP');
      // console.log(sourceModel);
      if (target === source) {
        if (this.isVirtualizedDrag(sourceModel)) {
          this.removeElement(dropElm); // element must be removed for ngFor to apply correctly
        }

        this.splice(sourceModel, dropIndex, 0, this.splice(sourceModel, dragIndex, 1)[0]);
      } else {
        this.removeElement(dropElm); // element must be removed for ngFor to apply correctly

        let notCopy = dragElm === dropElm;
        let targetModel = drake.models[drake.containers.indexOf(target)];
        let dropElmModel = notCopy ? this.getItem(sourceModel, dragIndex) : JSON.parse(JSON.stringify(this.getItem(sourceModel, dragIndex)));

        if (notCopy) {
          this.splice(sourceModel, dragIndex, 1);
        }
        this.splice(targetModel, dropIndex, 0, dropElmModel);
      }
      this.dropModel.emit([name, dropElm, target, source]);
    });
  }

  private getItem(model: any | any[], index: number): any {
    return this.isFormArray(model) ? model.at(index) : model[index];
  }

  private splice(model: any | any[], start: number, deleteCount: number, ...items: any[]): any[] {
    if (!this.isFormArray(model)) {
      return model.splice(start, deleteCount, ...items);
    }

    //FormArray splice
    let deleted = [];

    for (let i = start + deleteCount - 1; i >= start; i--) {
      deleted.push(model.at(i));
      model.removeAt(i);
    }

    for (let i = start, j = 0; j < items.length; i++, j++) {
      model.insert(i, items[j]);
    }

    return deleted.reverse();
  }

  private isFormArray(model: any | any[]): boolean {
    return !!model.at && !!model.insert && !!model.removeAt;
  }

  private setupEvents(bag: any): void {
    bag.initEvents = true;
    let that: any = this;
    let emitter = (type: any) => {
      function replicate(): void {
        let args = Array.prototype.slice.call(arguments);
        that[type].emit([bag.name].concat(args));
      }

      bag.drake.on(type, replicate);
    };
    this.events.forEach(emitter);
  }

  private domIndexOf(child: any, parent: any, drake: any): any {
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
    el.parentNode && el.parentNode.removeChild(el);
  }
}
