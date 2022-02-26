const fs = require('fs');
const path = require('path');
const ini = require('ini');
const lineReader = require('line-reader');

// const orig = 'G:\\C&C\\Zero Hour - Rise of the Reds - custom\\Data\\INI\\_rotr\\';
// const target = 'G:\\C&C\\Zero Hour - Rise of the Reds - custom\\Data\\INI\\';
// processDirs(orig, target).then(res => {
// 	console.log(res);
// });

const defTypes = {
	object: 'Object',
	weapon: 'Weapon',
	locomotor: 'Locomotor',
};

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

async function saveProperties(file, itemStarter, saveProps) {
	if (!file.new) {
		// make copy of file
		throw new Error('File copy not implemented');
	}
	const fileContents = fs.readFileSync(file.fullPath, {  encoding: 'utf8' });
	fs.writeFileSync(file.fullPath.replace('.ini', '_bak.ini'), fileContents);
	const lines = fileContents.split(/\r?\n/);
	const newProps = [];
	let started = false;
	for (const [ idx, line ] of lines.entries()) {
		if (line.trim().startsWith(itemStarter.trim())) {
			started = true;
		}
		if (started) {
			if (!line || !line.trim() || !line.includes('=')) continue;
			if (line.startsWith('End')) {
				break;
			}
			const propIdx = saveProps.findIndex(p => p.line === line);
			if (propIdx === -1) continue;
			const prop = saveProps[propIdx];
			lines[idx] = line.replace(prop.value, prop.newValue);
			saveProps.splice(propIdx, 1);
			newProps.push({ ...prop, value: prop.newValue, line: lines[idx] });
			if (!saveProps.length) break;
		}
	}
	if (saveProps.length === 0) {
		fs.writeFileSync(file.fullPath, lines.join('\r\n'));
		return newProps;
	}
	else {
		throw new Error('Could not save all properties: '  + saveProps.map(p => p.name).join(', '));
	}
}

async function processDirs(originalsDir, targetDir) {
	const originalPaths = scanDir(originalsDir, ['Art', 'MappedImages', 'Default']);
	const originalFiles = originalPaths.map(path => ({
		new: false,
		fullPath: path,
		relPath: path.replace(originalsDir, '')
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
	const proms = [];
	const weapons = [];
	const locomotors = [];
	const kindsToFind = {
		'VEHICLE': 'Vehicle',
		'FS_BASE_DEFENSE': 'Defense',
		'STRUCTURE': 'Building',
		'INFANTRY': 'Infantry'
	};
	const kindKeys = Object.keys(kindsToFind);
	const objectBasicProperties = [ 'BuildCost', 'BuildTime', 'VisionRange', 'ShroudClearingRange', 'Body.MaxHealth', 'Body.InitialHealth' ];
	const locoBasicProperties = [ 'Speed', 'SpeedDamaged', 'MinSpeed', 'Acceleration', 'AccelerationDamaged', 'Braking', 'TurnRate', 'TurnRateDamaged' ];
	const weapBasicProperties = [ 'PrimaryDamage', 'PrimaryDamageRadius', 'ScatterRadius', 'AttackRange', 'SecondaryDamage', 'SecondaryDamageRadius', 'ClipSize', 'DelayBetweenShots', 'ClipReloadTime', 'RadiusDamageAffects', 'DamageType' ];
	// re-pivot return data to be defs, with a file pointer, rather than files with defs in them - def as top level
	for (const file of files) {
		let def = null;
		let innerBlock = null;
		let innerBlockProperties = null;
		function checkForProperties(def, line, props) {
			let found = false;
			props.forEach(prop => {
				if (found) return;
				if (prop.includes('.')) {
					const [ blockName , propName ] = prop.split('.')
					if (!innerBlock && line.startsWith('  ' + blockName + ' ')) {
						innerBlock = blockName;
					}
					else if (innerBlock === blockName && line.startsWith('    ' + propName)) {
						const parts = line.match(/ ?= ?(.+?)(;.*)?$/);
						const propInfo = {
							line,
							value: parts[1].trim(),
							notes: (parts[2] || '').trim()
						};
						def.properties[prop] = propInfo;
						found = true;
					}
					else if (innerBlock && line.startsWith('  End')) {
						innerBlock = null;
						innerBlockProperties = null;
					}
					// nested object value
				}
				else {
					if (line.startsWith('  ' + prop + ' ')) {
						const parts = line.match(/ ?= ?(.+?)(;.*)?$/);
						const propInfo = {
							line,
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
		file.definitions = [];
		file.side = 'None';
		const readProm = new Promise(resolve => {
			let linesDone = 0;
			lineReader.eachLine(file.fullPath, {}, (line, done) => {
				linesDone++;
				if (!def && file.definitions.length === 0 && linesDone > 100) {
					resolve();
					return false;
				}
				if (def) {
					// Inside a definition
					if (line.startsWith('End')) {
						if (def.kind) {
							file.definitions.push(def);
							if (def.type === defTypes.locomotor) locomotors.push(def);
							if (def.type === defTypes.weapon) weapons.push(def);
						}
						def = null;
					}
					else if (def.type === 'Object') {
						if (line.startsWith('  KindOf')) {
							const kinds = line.split('=')[1].trim().split(' ');
							def.rawKinds = kinds;
							kindKeys.forEach(kind => {
								if (kinds.includes(kind)) {
									const kindName = kindsToFind[kind];
									if (!def.kind) def.kind = kindName;
									def.kinds.push(kindName);
								}
							});
						}
						else if (checkForProperties(def, line, objectBasicProperties)) {
							// Found and added by func
						}
						else {
							if (line.startsWith('  End') && innerBlock) {
								innerBlock = null;
								innerBlockProperties = null;
							}
							if (line.startsWith('  Locomotor')) {
								const loco = {
									name: line.match(/=\s+SET_[^\s]+\s+([^\s]+)/)?.[1],
									notes: line.match(/;.+$/)?.[0] || ''
								};
								if (loco.name) def.locomotor = loco;
							}
							else if (line.startsWith('  WeaponSet')) {
								innerBlock = 'WeaponSet';
							}
							else if (innerBlock === 'WeaponSet' && line.startsWith('    Weapon ')) {
								def.weapons = def.weapons || [];
								const [ _, type, name ] = line.split('=')[1].trim().match(/([^ ]+) +([^ ]+)\s*$/) || [ null, null, null ];
								if (type && name) {
									def.weapons.push({ type, name, ...(innerBlockProperties || {}) });
								}
							}
							else if (innerBlock === 'WeaponSet' && line.startsWith('    Conditions ')) {
								innerBlockProperties = innerBlockProperties || {};
								innerBlockProperties.Conditions = line.split('=')[1].trim();
							}
							// TODO: prerequisites
						}
					}
					else if (def.type === defTypes.weapon) {
						if (checkForProperties(def, line, weapBasicProperties)) {
							// Found and added by func
						}
					}
					else if (def.type === defTypes.locomotor) {
						if (checkForProperties(def, line, locoBasicProperties)) {
							// Found and added by func
						}
					}
				}
				else {
					// Looking for a definition
					if (line.startsWith('Object')) {
						def = {
							def: line,
							type: line.split(' ')[0],
							name: line.split(' ')[1],
							properties: {},
							weapons: [],
							kinds: [],
							kind: ''
						};
					}
					else if (line.startsWith(defTypes.weapon)) {
						def = {
							def: line,
							type: line.split(' ')[0],
							name: line.split(' ')[1],
							properties: {},
							kinds: [defTypes.weapon],
							kind: defTypes.weapon
						};
					}
					else if (line.startsWith(defTypes.locomotor)) {
						def = {
							def: line,
							type: line.split(' ')[0],
							name: line.split(' ')[1],
							properties: {},
							kinds: [defTypes.locomotor],
							kind: defTypes.locomotor
						};
					}
				}
				if (line.includes('Side')) {
					file.side = line.match(/\s*Side\s+=\s+([^\s]+)/i)?.[1];
				}
				if (done) {
					resolve();
					return false;
				}
			}, (err) => {
				file.linesRead = linesDone;
				if (err) file.error = err;
				resolve();
			});
		});
		proms.push(readProm);
		if (proms.length % 100 === 0) {
			file.awaited = true;
			await readProm;
		}
		// const config = ini.parse(fs.readFileSync(file.fullPath, 'utf-8'));
		// file.data = config;
	};
	await Promise.all(proms);
	const retFiles = files.filter(f => f.definitions.length);
	// const weaps = retFiles.flatMap(f => f.definitions.filter(d => d.type === defTypes.weapon));
	// const locos = retFiles.flatMap(f => f.definitions.filter(d => d.type === defTypes.locomotor));
	retFiles.forEach(file => {
		file.definitions.forEach(def => {
			if (def.locomotor) {
				const loco = locomotors.find(l => l.name === def.locomotor.name);
				if (loco) def.locomotor = { ...loco, ...def.locomotor };
			}
			if (def.weapons && def.weapons.length) {
				def.weapons.forEach((info, wi) => {
					const weap = weapons.find(w => w.name === info.name);
					if (weap) def.weapons[wi] = { ...weap, ...info };
				});
			}
		});
	})
	return retFiles;
}
