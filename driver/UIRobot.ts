/*
* Driver for the UIRobot program running on a computer accessed over the network.
* Copyright (c) 2019 PIXILAB Technologies AB, Sweden (http://pixilab.se). All Rights Reserved.
*/

import {NetworkTCP} from "system/Network";
import {Driver} from "system_lib/Driver";
import {callable, driver, property} from "system_lib/Metadata";

@driver('NetworkTCP', { port: 3047 })
export class UIRobot extends Driver<NetworkTCP> {
	private mLeftDown = false;
	private mRightDown = false;

	// The currently running program including dir and params (pipe-separated).
	private mProgramParams: string = '';

	// Currently pressed key combo
	private mCurrentKeys: string = '';
	private mKeyRlsTimer?: CancelablePromise<void>;	// Set while key down timer running

	// Program and arguments that need to run on peer to shut down. Assumes Windows.
	static readonly kPowerDownProgram = "C:/Windows/System32/shutdown.exe||/s /f /t 0";

	public constructor(protected socket: NetworkTCP, bufferSize?: number) {
		super(socket);
		if (bufferSize)
			socket.setMaxLineLength(bufferSize);
		socket.enableWakeOnLAN();	// Allows us to use wakeOnLAN in power property
		socket.autoConnect();

		socket.subscribe('connect', (sender, message) => {
			if (message.type === 'Connection')
				this.onConnectStateChanged(sender.connected);
		});

		// Handle initially connected state
		if (socket.connected)
			this.onConnectStateChanged(true);
	}

	/**	Connected state changed to the one specified by the parameter.
	 */
	protected onConnectStateChanged(connected: boolean) {
		if (!connected)
			this.mProgramParams = '';

		// We consider connection state as our "power" property's, so fire change for that
		this.changed("power");
	}

	/**
	 * Turn power of computer in other end on and off. Setting the power to ON will attempt
	 * to wake up the computer using Wake-on-LAN. Setting it to OFF will send a command to
	 * the peer to shut it down, using kPowerDownProgram.
	 */
	@property("Power computer on/off")
	public set power(power: boolean) {
		if (power) {
			if (!this.socket.connected)	// No need if already online
				this.socket.wakeOnLAN();
		} else
			this.program = UIRobot.kPowerDownProgram;
	}

	/**
	 * Consider power OFF if peer not connected OR if the last command sent was kPowerDownProgram.
	 * Note that the power ON state will be delayed visavi setting the property, since I won't
	 * consider power to be on until the computer actually connects, which will take quite a while
	 * from setting power to true.
	 */
	public get power(): boolean {
		return this.socket.connected && this.program !== UIRobot.kPowerDownProgram;
	}

	@property("Left mouse button down")
	public set leftDown(value: boolean) {
		if (this.mLeftDown !== value) {
			this.mLeftDown = value;
			this.sendMouseButtonState(1024, value);
		}
	}
	public get leftDown(): boolean {
		return this.mLeftDown;
	}

	@property("Right mouse button down")
	public set rightDown(value: boolean) {
		if (this.mRightDown !== value) {
			this.mRightDown = value;
			this.sendMouseButtonState(4096, value);
		}
	}
	public get rightDown(): boolean {
		return this.mRightDown;
	}

	@callable("Move mouse by specified distance")
	public moveMouse(x: number, y: number): void {
		this.sendCommand('MouseMove', x, y)
	}

	@property("The program to start, will end any previously running program. Format is EXE_PATH|WORKING_DIR|...ARGS")
	public set program(programParams: string) {
		// console.log("program", programParams);
		// First stop the previously runnig program, if any
		const runningProgram = this.parseProgramParams(this.mProgramParams);
		if (runningProgram) {
			this.sendCommand(
				'Terminate',
				runningProgram.program
			);
		}

		// Then launch any new program
		const newProgram = this.parseProgramParams(programParams);

		if (newProgram) {
			this.mProgramParams = programParams;
			this.sendCommand(
				'Launch',
				newProgram.workingDir,
				newProgram.program,
				...newProgram.arguments
			);
		} else {
			this.mProgramParams = '';
		}
	}
	public get program(): string {
		return this.mProgramParams;
	}

	/**
	 * Sends keys in the format of MODIFIER1+MODIFIER2+KEY
	 * Possible modifiers are:
	 * 	shift
	 * 	meta
	 * 	control
	 * 	alt
	 * 	altgr
	 * The keys sent are only remembered a short while and then reset, this is because
	 * we'd like some feedback when pusing a button on the panel.
	 */
	@property("Send key strokes, modifiers before key")
	public set keyDown(keys: string) {
		this.mCurrentKeys = keys;

		if (!!this.mCurrentKeys) {
			const keyPresses = keys.split('+');
			const key = keyPresses[keyPresses.length - 1];
			let modifierSum: number = 0;
			if (keyPresses.length > 1) {
				let modifiers = keyPresses.slice(0, keyPresses.length - 1);
				const modifierValues: any = {
					'shift': 1,
					'control': 2,
					'alt': 4,
					'altgr': 8,
					'meta': 16
				};
				modifiers.forEach(mod => modifierSum += modifierValues[mod] || 0);
			}
			this.sendCommand('KeyPress', key, modifierSum);

			if (this.mKeyRlsTimer) // Reset already running timer for new keystroke
				this.mKeyRlsTimer.cancel();
			this.mKeyRlsTimer = wait(200);
			this.mKeyRlsTimer.then(() => {
				this.keyDown = '';
				this.mKeyRlsTimer = undefined;
			});
		}
	}
	public get keyDown(): string {
		return this.mCurrentKeys;
	}

	/**
	 * Send button down/up, where buttonMask is one of the
	 * BUTTON_DOWN_MASK constants defined in se.pixilab.robot.MousePress
	 */
	private sendMouseButtonState(buttonMask: number, down: boolean) {
		this.sendCommand('MousePress', buttonMask, down ? 1 : 2);
	}

	/**
	 * Send command with any arguments separated by space to dest socket.
	 */
	protected sendCommand(command: string, ...args: any[]) {
		command += ' ' + args.join(' ');
		console.log("-------------command", command);
		return this.socket.sendText(command);
	}

	/**
	 * Parse out the up to three parameters in the form Format is EXE_PATH|WORKING_DIR|...ARGS
	 * into a ProgramParams object.
	 */
	private parseProgramParams(programParams?: string): ProgramParams|undefined {
		// console.log("parseProgramParams", programParams);
		if (programParams) {
			const params = programParams.split('|');
			const result = {
				program: UIRobot.quote(params[0]),
				workingDir: UIRobot.quote(params[1]) || '/',
				arguments: params.slice(2)
			};
			// console.log("parseProgramParams PROGRAM", result.program, "WORKING", result.workingDir, "ARGS", result.arguments.toString());
			return result;
		} // Else returns undefined if no/empty programParams
	}

	static quote(str: string) {
		return  '"' + str + '"';
	}
}

interface ProgramParams {
	program: string;
	workingDir?: string;
	arguments?: string[];
}
