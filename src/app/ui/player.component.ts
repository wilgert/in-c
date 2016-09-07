import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  animate,
  keyframes,
  style,
  transition,
  trigger
} from '@angular/core';
import { Store } from '@ngrx/store'; 
import { List } from 'immutable';
import * as Hammer from 'hammerjs';

import { AppState } from '../core/app-state.model';
import { PlayerState } from '../core/player-state.model';
import { PlaylistItem } from '../core/playlist-item.model';
import { PlayerStats } from '../core/player-stats.model';
import { ADVANCE, ADJUST_PAN } from '../core/actions';
import { TimeService } from '../core/time.service';
import { ColorService } from './color.service';

@Component({
  selector: 'in-c-player',
  template: `
    <div #circle
         class="circle"
         [style.left.px]="getCenterX() - getRadius()"
         [style.top.px]="getCenterY() - getRadius()"
         [style.width.px]="getRadius() * 2"
         [style.height.px]="getRadius() * 2"
         [style.transform]="getTransform()"
         [style.backgroundColor]="getColor()"
         (click)="advance()">
    </div>
  `,
  styles: [`
    .circle {
      position: absolute;
      cursor: move;
      border-radius: 50%;
      transition: transform 1s;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlayerComponent implements AfterViewInit {
  @Input() playerState: PlayerState;
  @Input() playerStats: PlayerStats;
  @Input() screenWidth: number;
  @Input() screenHeight: number;
  @ViewChild('circle') circle: ElementRef;
  panOffset = [0, 0];
  hammer: HammerManager;

  constructor(private time: TimeService,
              private colors: ColorService,
              private store: Store<AppState>) {
  }

  getCenterX() {
    return this.getX(this.playerState.pan);
  }

  getCenterY() {
    return this.getY(this.playerState.y);
  }

  getRadius() {
    return 60;
  }

  getTransform() {
    return `scale(${this.playerState.advanceFactor})`;
  }

  getColor() {
    return 'black';
  }

  ngAfterViewInit() {
    this.hammer = new Hammer(this.circle.nativeElement);
    this.hammer.on('panstart', evt => this.onPanStart(evt));
    this.hammer.on('panmove', evt => this.onPanMove(evt));
  }

  ngOnDestroy() {
    this.hammer.destroy();
  }

  advance() {
    this.store.dispatch({type: ADVANCE, payload: this.playerState.player.instrument});
  }

  onPanStart(evt: HammerInput) {
    this.panOffset = [evt.center.x - this.getCenterX(), evt.center.y - this.getCenterY()];
  }

  onPanMove(evt: HammerInput) {
    const newPan = ((evt.center.x - this.panOffset[0]) / this.screenWidth) * 2 - 1;
    const newY = ((evt.center.y - this.panOffset[1]) / this.screenHeight) * 2 - 1;
    this.store.dispatch({type: ADJUST_PAN, payload: {instrument: this.playerState.player.instrument, pan: newPan, y: newY}});
  }

  private getX(x: number) {
    const relativeX = (x + 1) / 2;
    return relativeX * this.screenWidth;
  }

  getY(y: number ) {
    const relativeY = (y + 1) / 2;
    return relativeY * this.screenHeight;
  }

}