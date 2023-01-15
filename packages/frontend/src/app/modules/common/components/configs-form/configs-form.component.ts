import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
	ControlValueAccessor,
	UntypedFormBuilder,
	UntypedFormControl,
	UntypedFormGroup,
	NG_VALIDATORS,
	NG_VALUE_ACCESSOR,
	ValidatorFn,
	Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import {
	catchError,
	combineLatest,
	debounceTime,
	distinctUntilChanged,
	map,
	Observable,
	of,
	shareReplay,
	startWith,
	switchMap,
	take,
	tap,
} from 'rxjs';
import { ActionMetaService, DropdownState } from 'src/app/modules/flow-builder/service/action-meta.service';
import { fadeInUp400ms } from '../../animation/fade-in-up.animation';
import { ThemeService } from '../../service/theme.service';
import { PieceConfig, InputType } from './connector-action-or-config';
import {
	NewAuthenticationModalComponent,
	USE_CLOUD_CREDENTIALS,
} from 'src/app/modules/flow-builder/page/flow-builder/flow-right-sidebar/edit-step-sidebar/edit-step-accordion/input-forms/component-input-forms/new-authentication-modal/new-authentication-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { AppConnection, AppConnectionType, CloudAuth2Connection, OAuth2AppConnection } from 'shared';
import { DropdownItem } from '../../model/dropdown-item.interface';
import {
	NewCloudAuthenticationModalComponent,
	USE_MY_OWN_CREDENTIALS,
} from 'src/app/modules/flow-builder/page/flow-builder/flow-right-sidebar/edit-step-sidebar/edit-step-accordion/input-forms/component-input-forms/new-cloud-authentication-modal/new-cloud-authentication-modal.component';
import { CloudAuthConfigsService } from '../../service/cloud-auth-configs.service';
import { AuthenticationService } from '../../service/authentication.service';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { BuilderSelectors } from 'src/app/modules/flow-builder/store/builder/builder.selector';
type ConfigKey = string;

@Component({
	selector: 'app-configs-form',
	templateUrl: './configs-form.component.html',
	styleUrls: ['./configs-form.component.scss'],
	providers: [
		{
			provide: NG_VALUE_ACCESSOR,
			multi: true,
			useExisting: ConfigsFormComponent,
		},
		{
			provide: NG_VALIDATORS,
			multi: true,
			useExisting: ConfigsFormComponent,
		},
	],
	animations: [fadeInUp400ms],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigsFormComponent implements ControlValueAccessor {
	faInfoCircle = faInfoCircle;
	checkingOAuth2CloudManager = false;
	configs: PieceConfig[] = [];
	requiredConfigs: PieceConfig[] = [];
	allOptionalConfigs: PieceConfig[] = [];
	selectedOptionalConfigs: PieceConfig[] = [];
	optionalConfigsMenuOpened = false;
	@Input() stepName: string;
	@Input() pieceName: string;
	@Input() pieceDisplayName: string;
	form!: UntypedFormGroup;
	OnChange = value => { };
	OnTouched = () => { };
	updateValueOnChange$: Observable<void> = new Observable<void>();
	updateAuthConfig$: Observable<void>;
	configType = InputType;
	optionsObservables$: {
		[key: ConfigKey]: Observable<DropdownState<any>>;
	} = {};
	dropdownsLoadingFlags$: { [key: ConfigKey]: Observable<boolean> } = {};
	allAuthConfigs$: Observable<DropdownItem[]>;
	updateOrAddConfigModalClosed$: Observable<void>;
	configDropdownChanged$: Observable<any>;
	cloudAuthCheck$: Observable<void>;
	constructor(
		private fb: UntypedFormBuilder,
		public themeService: ThemeService,
		private actionMetaDataService: ActionMetaService,
		private dialogService: MatDialog,
		private store: Store,
		private cloudAuthConfigsService: CloudAuthConfigsService,
		private authenticationService: AuthenticationService
	) {
		this.allAuthConfigs$ = this.store.select(BuilderSelectors.selectAppConnectionsDropdownOptions);
	}

	writeValue(obj: PieceConfig[]): void {
		this.configs = obj;
		this.createForm();
	}
	registerOnChange(fn: any): void {
		this.OnChange = fn;
	}
	registerOnTouched(fn: any): void {
		this.OnTouched = fn;
	}
	setDisabledState(disabled: boolean) {
		if (disabled) {
			this.form.disable();
		} else {
			this.form.enable();
		}
	}
	validate() {
		if (this.form.invalid) {
			return { invalid: true };
		}
		return null;
	}
	createForm() {
		this.requiredConfigs = this.configs.filter(c => c.required);
		this.allOptionalConfigs = this.configs.filter(c => !c.required);
		this.selectedOptionalConfigs = this.allOptionalConfigs.filter(c => c.value !== undefined);
		const requiredConfigsControls = this.createConfigsFormControls(this.requiredConfigs);
		const optionalConfigsControls = this.createConfigsFormControls(this.selectedOptionalConfigs);
		this.form = this.fb.group({ ...requiredConfigsControls, ...optionalConfigsControls });
		this.createDropdownConfigsObservables();
		this.updateValueOnChange$ = this.form.valueChanges.pipe(
			tap(value => {
				this.OnChange(value);
			}),
			map(() => void 0)
		);

		this.form.markAllAsTouched();
	}

	createDropdownConfigsObservables() {
		this.configs.forEach(c => {
			if (c.type === InputType.DROPDOWN) {
				const refreshers$ = {};
				c.refreshers!.forEach(r => {
					refreshers$[r] = this.form.controls[r].valueChanges.pipe(
						distinctUntilChanged((prev, curr) => {
							return JSON.stringify(prev) === JSON.stringify(curr);
						}),
						startWith(this.configs.find(c => c.key === r)!.value),
						debounceTime(150)
					);
				});
				if (c.refreshers!.length === 0) {
					refreshers$['oneTimeRefresh'] = of(true);
				}
				this.optionsObservables$[c.key] = combineLatest(refreshers$).pipe(
					switchMap(res => {
						return this.store.select(BuilderSelectors.selectCurrentCollection).pipe(take(1), switchMap(collection => {
							return this.actionMetaDataService.getConnectorActionConfigOptions(
								{ propertyName: c.key, stepName: this.stepName, input: res, collectionVersionId: collection.version!.id },
								this.pieceName
							);
						}));
					}),
					shareReplay(1),
					catchError(err => {
						console.error(err);
						return of({ options: [], disabled: true, placeholder: 'unknown server erro happend, check console' });
					})
				);
				this.dropdownsLoadingFlags$[c.key] = this.optionsObservables$[c.key].pipe(
					startWith(null),
					map(val => {
						if (val === null) return true;
						if (!Array.isArray(val.options)) {
							console.error(`Activepieces- Config ${c.label} options are not returned in array form--> ${val}`);
						}
						return false;
					})
				);
			}
		});
	}

	private createConfigsFormControls(configs: PieceConfig[]) {
		const controls: { [key: string]: UntypedFormControl } = {};
		configs.forEach(c => {
			const validators: ValidatorFn[] = [];
			if (c.required) {
				validators.push(Validators.required);
			}
			controls[c.key] = new UntypedFormControl(c.value, validators);
		});
		return controls;
	}
	getControl(configKey: string) {
		return this.form.get(configKey);
	}

	removeConfig(config: PieceConfig) {
		this.form.removeControl(config.key);
		const configIndex = this.allOptionalConfigs.findIndex(c => c === config);
		this.selectedOptionalConfigs.splice(configIndex, 1);
	}

	addOptionalConfig(config: PieceConfig) {
		this.form.addControl(config.key, new UntypedFormControl());
		this.selectedOptionalConfigs.push(config);
	}

	newAuthenticationDialogProcess(pieceConfigName: string) {
		if (!this.checkingOAuth2CloudManager) {
			this.checkingOAuth2CloudManager = true;
			this.cloudAuthCheck$ = this.cloudAuthConfigsService.getAppsAndTheirClientIds().pipe(
				catchError(err => {
					console.error(err);
					return of({});
				}),
				tap(() => {
					this.checkingOAuth2CloudManager = false;
				}),
				map(res => {
					return res[this.pieceName];
				}),
				tap((cloudAuth2Config: { clientId: string }) => {
					if (cloudAuth2Config) {
						this.openNewCloudOAuth2ConnectionModal(pieceConfigName, cloudAuth2Config.clientId);
					} else {
						this.openNewAuthenticationModal(pieceConfigName);
					}
				}),
				map(() => void 0)
			);
		}
	}
	openNewAuthenticationModal(authConfigName: string) {
		this.updateOrAddConfigModalClosed$ = this.authenticationService.getFrontendUrl().pipe(
			switchMap(serverUrl => {
				return this.dialogService
					.open(NewAuthenticationModalComponent, {
						data: {
							pieceAuthConfig: this.configs.find(c => c.type === InputType.OAUTH2),
							pieceName: this.pieceName,
							serverUrl: serverUrl,
						},
					})
					.afterClosed()
					.pipe(
						tap((result: OAuth2AppConnection | string) => {
							if (typeof result === 'string' && result === USE_CLOUD_CREDENTIALS) {
								this.checkingOAuth2CloudManager = true;
								this.cloudAuthCheck$ = this.cloudAuthConfigsService.getAppsAndTheirClientIds().pipe(
									catchError(err => {
										console.error(err);
										return of({});
									}),
									tap(() => {
										this.checkingOAuth2CloudManager = false;
									}),
									map(res => {
										return res[this.pieceName];
									}),
									tap((cloudAuth2Config: { clientId: string }) => {
										this.openNewCloudOAuth2ConnectionModal(authConfigName, cloudAuth2Config.clientId);
									}),
									map(() => void 0)
								);
							} else if (typeof result === 'object') {
								const authConfigOptionValue = `\${connections.${result.name}}`;
								this.form.get(authConfigName)!.setValue(authConfigOptionValue);
							}
						}),
						map(() => void 0)
					);
			})
		);
	}

	openNewCloudOAuth2ConnectionModal(authConfigKey: string, clientId: string) {
		this.updateOrAddConfigModalClosed$ = this.dialogService
			.open(NewCloudAuthenticationModalComponent, {
				data: {
					pieceAuthConfig: this.configs.find(c => c.type === InputType.OAUTH2),
					pieceName: this.pieceName,
					clientId: clientId,
				},
			})
			.afterClosed()
			.pipe(
				tap((result: AppConnection | string) => {
					if (typeof result === 'object') {
						const authConfigOptionValue = `\${connections.${result.name}}`;
						this.form.get(authConfigKey)!.setValue(authConfigOptionValue);
					} else if (result === USE_MY_OWN_CREDENTIALS) {
						this.openNewAuthenticationModal(authConfigKey);
					}
				}),
				map(() => void 0)
			);
	}
	editSelectedAuthConfig(authConfigKey: string) {
		const selectedValue: any = this.form.get(authConfigKey)!.value;
		const allConnections$ = this.store.select(BuilderSelectors.selectAllAppConnections);
		this.updateAuthConfig$ = allConnections$.pipe(
			take(1),
			map(connections => {
				const connection = connections.find(
					c => selectedValue && c.name === this.getConnectionNameFromInterpolatedString(selectedValue)
				);
				return connection;
			}),
			tap(connection => {
				if (connection) {
					if (connection.value.type === AppConnectionType.OAUTH2) {
						this.updateOrAddConfigModalClosed$ = this.dialogService
							.open(NewAuthenticationModalComponent, {
								data: {
									connectionToUpdate: connection,
									pieceAuthConfig: this.configs.find(c => c.type === InputType.OAUTH2),
									pieceName: this.pieceName,
								},
							})
							.afterClosed()
							.pipe(
								tap((newOAuth2Connection: OAuth2AppConnection) => {
									if (newOAuth2Connection) {
										const connectionValue = newOAuth2Connection.value;
										this.form.get(authConfigKey)!.setValue(connectionValue);
									}
								}),
								map(() => void 0)
							);
					} else {
						if (!this.checkingOAuth2CloudManager) {
							this.checkingOAuth2CloudManager = true;
							this.updateOrAddConfigModalClosed$ = this.cloudAuthConfigsService.getAppsAndTheirClientIds().pipe(
								tap(() => {
									this.checkingOAuth2CloudManager = false;
								}),
								switchMap(res => {
									const clientId = res[this.pieceName].clientId;
									return this.dialogService
										.open(NewCloudAuthenticationModalComponent, {
											data: {
												connectionToUpdate: connection,
												pieceAuthConfig: this.configs.find(c => c.type === InputType.OAUTH2),
												pieceName: this.pieceName,
												clientId: clientId,
											},
										})
										.afterClosed()
										.pipe(
											tap((cloudOAuth2Connection: CloudAuth2Connection) => {
												if (cloudOAuth2Connection) {
													const authConfigOptionValue = cloudOAuth2Connection.value;
													this.form.get(authConfigKey)!.setValue(authConfigOptionValue);
												}
											}),
											map(() => void 0)
										);
								})
							);
						}
					}
				}
			}),
			map(() => void 0)
		);
	}

	dropdownCompareWithFunction = (opt: string, formControlValue: string) => {
		return opt === formControlValue;
	};
	getConnectionNameFromInterpolatedString(interpolatedString: string) {
		//eg. ${connections.google}
		const result = interpolatedString.split('${connections.')[1];
		return result.slice(0, result.length - 1);
	}
}
