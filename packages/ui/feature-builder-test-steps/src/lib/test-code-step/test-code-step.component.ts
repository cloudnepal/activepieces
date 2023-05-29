import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  BuilderSelectors,
  FlowsActions,
} from '@activepieces/ui/feature-builder-store';
import {
  Observable,
  Subject,
  distinctUntilChanged,
  forkJoin,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs';
import {
  ActionType,
  CodeAction,
  CodeExecutionResult,
} from '@activepieces/shared';
import { Store } from '@ngrx/store';
import { TestStepCoreComponent } from '../test-steps-core.component';
import { TestStepService } from '@activepieces/ui/common';
import deepEqual from 'deep-equal';
@Component({
  selector: 'app-test-code-step',
  templateUrl: './test-code-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestCodeStepComponent extends TestStepCoreComponent {
  testing$: Subject<boolean> = new Subject();
  startTest$: Observable<void>;
  testDialogClosed$: Observable<void>;
  stepTest$: Observable<CodeExecutionResult>;
  lastTestResult$: Observable<unknown | undefined>;
  saveTestResult$: Observable<void>;
  saveStepAfterTesting$: Observable<void>;
  lastTestDate$: Observable<string | undefined>;
  constructor(store: Store, testStepService: TestStepService) {
    super(testStepService, store);
    this.lastTestResult$ = this.store
      .select(BuilderSelectors.selectStepTestSampleData)
      .pipe(
        distinctUntilChanged((prev, current) => {
          return deepEqual(prev, current);
        })
      );
    this.lastTestDate$ = this.store
      .select(BuilderSelectors.selectLastTestDate)
      .pipe(
        distinctUntilChanged((prev, current) => {
          return prev === current;
        })
      );
  }

  testStep() {
    this.testing$.next(true);
    const testCodeParams$ = forkJoin({
      step: this.store.select(BuilderSelectors.selectCurrentStep).pipe(take(1)),
      flowVersionId: this.store
        .select(BuilderSelectors.selectCurrentFlowVersionId)
        .pipe(take(1)),
    });
    this.stepTest$ = testCodeParams$.pipe(
      switchMap((params) => {
        if (params.step && params.flowVersionId)
          return this.testStepService.testPieceOrCodeStep<CodeExecutionResult>({
            stepName: params.step.name,
            flowVersionId: params.flowVersionId,
          });
        throw Error(
          `Flow version Id or step name are undefined, step:${params.step} versionId:${params.flowVersionId}`
        );
      }),
      map((result) => result.output),
      tap((result) => {
        this.saveTestResult(result);
        this.testing$.next(false);
      })
    );
  }
  saveTestResult(result: CodeExecutionResult) {
    if (!result.standardError) {
      this.saveStepAfterTesting$ = this.store
        .select(BuilderSelectors.selectCurrentStep)
        .pipe(
          take(1),
          tap((step) => {
            if (step && step.type === ActionType.CODE) {
              debugger;
              const clone: CodeAction = {
                ...step,
                settings: {
                  ...step.settings,
                  inputUiInfo: {
                    currentSelectedData:
                      result.output || result.output
                        ? result.output
                        : result.output === undefined
                        ? 'undefined'
                        : JSON.stringify(result.output),
                    lastTestDate: new Date().toString(),
                  },
                },
              };
              this.store.dispatch(
                FlowsActions.updateAction({
                  operation: clone,
                })
              );
            }
          }),
          map(() => void 0)
        );
    }
  }
}
