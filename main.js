const fs = require('fs');
const path = require('path');
// const ini = require('ini');
// const lineReader = require('line-reader');


const defTypes = {
	object: 'Object',
	weapon: 'Weapon',
	armour: 'Armor',
	locomotor: 'Locomotor',
};

// const orig = 'G:\\C&C\\Zero Hour - Rise of the Reds - custom\\Data\\INI\\_rotr\\';
// const target = 'G:\\C&C\\Zero Hour - Rise of the Reds - custom\\Data\\INI\\';
// processDirs(orig, target).then(res => {
// 	console.log(res);
// 	setTimeout(() =>console.log(69), 5500);
// });

function scanDir(dir, skipDirNames = []) {
	const filePaths = [];
	fs.readdirSync(dir).forEach(entry => {
		const fullPath = path.join(dir, entry);
		if (fs.statSync(fullPath).isDirectory()) {
			if (skipDirNames?.includes(entry)) return;
			else filePaths.push(...scanDir(fullPath, skipDirNames));
		}
		else if (entry.endsWith('.ini')) filePaths.push(fullPath);
	});
	return filePaths;
}

function fileToLines(filePath) {
	return new Promise((resolve, reject) => {
		fs.readFile(filePath, (err, data) => {
			if (err) reject(err);
			else resolve(data.toString().split(/\r?\n/));
		});
	});
}

async function updateDefinitions(defs) {
	const files = [];
	defs.forEach(def => {
		if (!def.changedProps || !def.changedProps.length) return;
		let file = files.find(f => f.relPath === def.file.relPath);
		if (!file) {
			file = {
				...def.file,
				defs: []
			};
			files.push(file);
		}
		file.defs.push(def);
	});
	for (const file of files.filter(f => !f.new)) {
		if (!file.newFullPath) throw new Error('Unknown target location for file: ' + file.fullPath);
		const dir = path.dirname(file.newFullPath);
		fs.mkdirSync(dir, { recursive: true });
		fs.copyFileSync(file.fullPath, file.newFullPath);
		if (fs.existsSync(file.newFullPath)) {
			file.new = true;
			file.fullPath = file.newFullPath;
			delete file.newFullPath;
		}
		else {
			throw new Error('Failed creating file: ' + file.newFullPath);
		}
	}
	for (const file of files) {
		file.defs.sort((d1, d2) => d1.lineIdx - d2.lineIdx);
		const lines = await fileToLines(file.fullPath);
		let changeMade = false;
		file.defs.forEach(def => {
			def.changedProps.forEach(prop => {
				const line = lines[prop.lineIdx];
				if (line !== prop.line) throw new Error('Line mismatch');
				let newLine = line;
				if (def.type === defTypes.armour) {
					// armour specific handling
					newLine = line.replace(prop.value, prop.newValue);
					if (newLine === line || !newLine) throw new Error('Line update failed');
					if (/^\d+%$/.test(prop.value) && !RegExp('; \\d+%').test(newLine)) {
						newLine = newLine.replace(/(\s?;.+)?$/, ' ; ' + prop.value + '$1');
					}
				}
				else {
					newLine = line.replace(RegExp('^(\\s+[^=]+=\\s*)(.+?)(\\s*(;.*$|$))'), '$1' + prop.newValue + '$3');
					if (newLine === line || !newLine) throw new Error('Line update failed');
					if (/^[\d\.]+$/.test(prop.value) && !RegExp('; [\\d\\.]+').test(newLine)) {
						newLine = newLine.replace(/(\s?;.+)?$/, ' ; ' + prop.value + '$1');
					}
				}
				lines[prop.lineIdx] = newLine;
				prop.newLine = newLine;
				prop.newNotes = newLine.match(/(;.*)?$/)?.[1] || '';
				changeMade = true;
			});
		});
		if (changeMade) {
			fs.copyFileSync(file.fullPath, file.fullPath.replace('.ini', '_bak.ini'));
			const fileContents = lines.join('\r\n');
			fs.writeFileSync(file.fullPath, fileContents);
			file.defs.forEach(def => {
				Object.values(def.properties).forEach(prop => {
					const changed = def.changedProps.find(p => p === prop);
					if (!changed) return;
					prop.value = prop.newValue;
					prop.line = prop.newLine;
					prop.notes = prop.newNotes;
					delete prop.newLine;
					delete prop.newValue;
					delete prop.newNotes;
				});
				delete def.changedProps;
			});
		}
	}
	return true;
}

async function processDirs(originalsDir, targetDir) {
	const originalPaths = scanDir(originalsDir, ['Art', 'MappedImages', 'Default']);
	const originalFiles = originalPaths.map(filePath => ({
		new: false,
		fullPath: filePath,
		newFullPath: path.join(targetDir, filePath.replace(originalsDir, '')),
		relPath: filePath.replace(originalsDir, '')
	}));
	const skipNewDirFolders = [];
	if (originalsDir.startsWith(targetDir)) {
		skipNewDirFolders.push(originalsDir.replace(targetDir, '').split(/[\\\/]/)[0]);
	}
	const newPaths = scanDir(targetDir, skipNewDirFolders);
	const newFiles = newPaths.map(path => ({
		new: true,
		fullPath: path,
		relPath: path.replace(targetDir, '')
	}));
	const files = [];
	const excludeFiles = ['ParticleSystem.ini'];
	newFiles.forEach(file => {
		if (file.relPath.endsWith('_bak.ini')) return;
		if (excludeFiles.some(p => file.relPath.includes(p))) return;
		files.push(file);
	});
	originalFiles.forEach(file => {
		if (file.relPath.endsWith('_bak.ini')) return;
		if (excludeFiles.some(p => file.relPath.includes(p))) return;
		if (files.find(f => f.relPath === file.relPath)) return;
		else files.push(file);
	});
	const definitions = [];

	const proms = [];
	const parsing = {
		defTypes: Object.values(defTypes),
		objectKinds: {
			'VEHICLE': 'Vehicle',
			'FS_BASE_DEFENSE': 'Defense',
			'STRUCTURE': 'Building',
			'INFANTRY': 'Infantry',
			'DRONE': 'Drone'
		},
		objectProps: [ 'BuildCost', 'BuildTime', 'VisionRange', 'ShroudClearingRange', 'Body.MaxHealth', 'Body.InitialHealth' ],
		locoProps: [ 'Speed', 'SpeedDamaged', 'MinSpeed', 'Acceleration', 'AccelerationDamaged', 'Braking', 'TurnRate', 'TurnRateDamaged' ],
		weapProps: [ 'PrimaryDamage', 'PrimaryDamageRadius', 'ScatterRadius', 'AttackRange', 'SecondaryDamage', 'SecondaryDamageRadius', 'ClipSize', 'DelayBetweenShots', 'ClipReloadTime', 'RadiusDamageAffects', 'DamageType' ],
	};
	// re-pivot return data to be defs, with a file pointer, rather than files with defs in them - def as top level
	for (const file of files) {
		let def = null;
		let subdef = null;

		function endSubdef() {
			subdef = null;
		}
		function endDef() {
			endSubdef();
			if (def) {
				if (def.type === defTypes.object && !def.side) {
					return;
				}
				else {
					def.file = file;
					definitions.push(def);
				}
				def = null;
			}
		}
		function checkForProperties(line, lineIdx, props) {
			let found = false;
			props.forEach(prop => {
				if (found) return;
				if (prop.includes('.')) {
					const [ blockName , propName ] = prop.split('.')
					if (!subdef && line.startsWith('  ' + blockName + ' ')) {
						subdef = { name: blockName };
					}
					else if (subdef && subdef.name === blockName && line.startsWith('    ' + propName)) {
						const parts = line.match(/ ?= ?(.+?)(;.*)?$/);
						const propInfo = {
							line,
							lineIdx,
							value: parts[1].trim(),
							notes: (parts[2] || '').trim()
						};
						def.properties[prop] = propInfo;
						found = true;
					}
					else if (subdef && line.startsWith('  End')) {
						endSubdef();
					}
					// nested object value
				}
				else {
					if (line.startsWith('  ' + prop + ' ')) {
						const parts = line.match(/ ?= ?(.+?)(;.*)?$/);
						const propInfo = {
							line,
							lineIdx,
							value: parts[1].trim(),
							notes: (parts[2] || '').trim()
						};
						def.properties[prop] = propInfo;
						found = true;
					}
				}
			});
			return found;
		}
		const readProm = fileToLines(file.fullPath).then(lines => {
			for (const [ lineIdx, line ] of lines.entries()) {
				if (!def && definitions.length === 0 && lineIdx > 80) break;
				if (def) {
					// Inside a definition
					if (line.startsWith('End')) {
						endDef();
					}
					else if (def.type === 'Object') {
						if (line.startsWith('  Side')) {
							def.side = line.split('=')[1].trim().split(' ')[0];
						}
						else if (line.startsWith('  KindOf')) {
							const kinds = line.split('=')[1].trim().split(' ');
							def.rawKinds = kinds;
							Object.keys(parsing.objectKinds).forEach(kind => {
								if (!kinds.includes(kind)) return;
								const kindName = parsing.objectKinds[kind];
								if (!def.kind) def.kind = kindName;
								def.kinds.push(kindName);
							});
						}
						else if (line.startsWith('  EditorSorting')) {
							const val = line.split('=')[1].trim().split(/[ ;]/)[0];
							if (val === 'SYSTEM') def = null;
						}
						else if (checkForProperties(line, lineIdx, parsing.objectProps)) {
							// Found and added by func
						}
						else if (subdef) {
							if (line.startsWith('  End') && subdef) {
								endSubdef();
							}
							else if (subdef.name === 'ArmorSet' && line.startsWith('    Armor ')) {
								const armour = {
									name: line.match(/=\s*([^\s]+)/)?.[1],
									notes: line.match(/;.+$/)?.[0] || ''
								};
								def.armour = armour;
							}
							else if (subdef.name === 'WeaponSet') {
								if (line.startsWith('    Weapon ')) {
									def.weapons = def.weapons || [];
									const [ _, type, name ] = line.split('=')[1].trim().match(/([^ ]+) +([^ ]+)\s*$/) || [ null, null, null ];
									if (type && name) {
										def.weapons.push({ type, name, ...subdef.properties });
									}
								}
								if (line.startsWith('    Conditions ')) {
									subdef.properties.Conditions = line.split('=')[1].trim();
								}
							}
						}
						else {
							if (line.startsWith('  Locomotor')) {
								const loco = {
									name: line.match(/=\s+SET_[^\s]+\s+([^\s]+)/)?.[1],
									notes: line.match(/;.+$/)?.[0] || ''
								};
								if (loco.name) def.locomotor = loco;
							}
							else if (line.startsWith('  WeaponSet')) {
								subdef = { name: 'WeaponSet', properties: {} };
							}
							else if (line.startsWith('  ArmorSet')) {
								subdef = { name: 'ArmorSet', properties: {} };
							}
							// TODO: prerequisites
						}
					}
					else if (def.type === defTypes.weapon) {
						if (checkForProperties(line, lineIdx, parsing.weapProps)) {
							// Found and added by func
						}
					}
					else if (def.type === defTypes.locomotor) {
						if (checkForProperties(line, lineIdx, parsing.locoProps)) {
							// Found and added by func
						}
					}
					else if (def.type === defTypes.armour) {
						if (line.startsWith('  Armor = ')) {
							const parts = line.match(/ ?= ?([^\s]+?)\s+(\d+%)\s*(;.*)?$/);
							const propInfo = {
								line,
								lineIdx,
								value: parts[2].trim(),
								notes: (parts[3] || '').trim()
							};
							def.properties[parts[1]] = propInfo;
						}
					}
				}
				else {
					// Looking for a definition
					if (!line.startsWith(' ') && parsing.defTypes.some(type => line.startsWith(type))) {
						def = {
							line,
							lineIdx,
							side: '',
							type: line.split(' ')[0],
							name: line.split(' ')[1],
							properties: {},
							kinds: [],
							kind: ''
						};
						def.kind = def.type;
						def.kinds = [ def.type ];
						if (def.type === defTypes.object) {
							def.kind = '';
							def.kinds = [];
							def.weapons = [];
						}
						if (def.name.startsWith('CINE_')) def = null;
					}
				}
			}
		}).catch(err => {
			file.error = err;
		});
		proms.push(readProm);
		if (proms.length % 100 === 0) {
			await readProm;
		}
	}
	await Promise.all(proms);
	const objects = definitions.filter(d => d.type === defTypes.object);
	const weapons = definitions.filter(d => d.type === defTypes.weapon);
	const armours = definitions.filter(d => d.type === defTypes.armour);
	const locomotors = definitions.filter(d => d.type === defTypes.locomotor);
	function setSide(side, refDef) {
		if (side && !refDef.side) refDef.side = side;
		if (side && refDef.side && refDef.side !== side) {
			if (!refDef.sides) refDef.sides = [ refDef.side, side ];
			if (!refDef.sides.includes(side)) refDef.sides.push(side);
		}
	}
	objects.forEach(obj => {
		if (obj.locomotor) {
			const loco = locomotors.find(l => l.name === obj.locomotor.name);
			if (!loco)  return;
			setSide(obj.side, loco);
			obj.locomotor = loco;
		}
		if (obj.armour) {
			const armour = armours.find(a => a.name === obj.armour.name);
			if (!armour)  return;
			setSide(obj.side, armour);
			obj.armour = armour;
		}
		if (obj.weapons && obj.weapons.length) {
			obj.weapons.forEach((info, wi) => {
				const weap = weapons.find(w => w.name === info.name);
				if (!weap)  return;
				setSide(obj.side, weap);
				obj.weapons[wi] = weap;
			});
		}
	});
	// TODO: Add support for ObjectCreationList
	return [
		...objects.filter(o => o.side),
		...armours.filter(a => a.side),
		...weapons.filter(w => w.side),
		...locomotors.filter(l => l.side),
	];
}
