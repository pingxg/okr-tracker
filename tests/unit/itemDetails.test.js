import { cleanDetails, editableDetails } from '../../src/util/itemDetails';

describe('cleanDetails', () => {
  test('trims text and keeps filled groups and rows in order', () => {
    expect(
      cleanDetails([
        {
          title: '  基本信息 ',
          fields: [
            { label: ' 注册号', value: '1234567-8 ' },
            { label: '地址', value: 'Helsinki' },
          ],
        },
      ])
    ).toEqual([
      {
        title: '基本信息',
        fields: [
          { label: '注册号', value: '1234567-8' },
          { label: '地址', value: 'Helsinki' },
        ],
      },
    ]);
  });

  test('drops empty rows and empty groups', () => {
    expect(
      cleanDetails([
        { title: '', fields: [{ label: '', value: '  ' }] },
        { title: 'Contact', fields: [{ label: '', value: '' }] },
        { title: '', fields: [{ label: 'Phone', value: '' }] },
      ])
    ).toEqual([
      { title: 'Contact', fields: [] },
      { title: '', fields: [{ label: 'Phone', value: '' }] },
    ]);
  });

  test('copes with missing or malformed data', () => {
    expect(cleanDetails(undefined)).toEqual([]);
    expect(cleanDetails([null, { title: 5, fields: 'x' }])).toEqual([]);
  });
});

describe('editableDetails', () => {
  test('returns a copy that can be edited without touching the item', () => {
    const stored = [{ title: 'A', fields: [{ label: 'x', value: '1' }] }];
    const copy = editableDetails(stored);
    copy[0].fields[0].value = '2';
    expect(stored[0].fields[0].value).toBe('1');
  });
});
